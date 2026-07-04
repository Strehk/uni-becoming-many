/**
 * Clock — the single time spine (docs/time-signals-theatre-plan.md §2).
 *
 * A controllable *virtual* clock. The frame loop feeds it the real frame delta; it produces a
 * scaled virtual time with transport controls (pause / resume / seek / timeScale) and fires
 * **discrete time-cues** as virtual time crosses their scheduled moments. Firing is frame-accurate
 * (a virtual clock with transport can't be pre-scheduled on AudioContext time) and re-arms
 * correctly on `seek`/`reset`, so a jump never double-fires or bursts.
 *
 * It is the *sole* authority on time: everything animated — authored (Theatre's sequence, slaved
 * via `sequence.position = clock.now`) or emergent — advances through it, so pause/seek/timeScale
 * govern the whole world for free.
 *
 * Deliberately decoupled: the clock has no dependency on the signal registry or the renderer.
 * main.ts publishes `signals.time.value = clock.now` right after `advance` — that one line is the
 * only bridge to the reactive world, and keeping it at the call site leaves the clock pure and
 * unit-testable. Its `schedule()` is conceptually "the time-specialised case of `bus.when`"; we
 * keep the bespoke implementation because its seek/re-arm correctness is exactly what audio cues
 * depend on.
 *
 * Concept-ported from neural-flight-template's `ExperienceClock` — same semantics, adapted to this
 * repo's factory/handle style and stripped of its SvelteKit coupling.
 */

export interface TimelineHandle {
  readonly id: string;
  cancel(): void;
}

export interface ScheduleOptions {
  /** Explicit id (else auto-generated); also used to cancel/replace an existing cue. */
  id?: string;
  /** Seconds added to the scheduled time (negative = earlier). */
  offset?: number;
  /** Repeat interval in seconds; omit for a one-shot. */
  every?: number;
  /** Max number of fires when `every` is set; default Infinity. */
  repeat?: number;
}

interface TimelineEvent {
  id: string;
  /** Effective first-fire time (at + offset). */
  base: number;
  /** 0 = one-shot. */
  every: number;
  /** Original max fire count (re-applied on reset/seek). */
  repeatCap: number;
  /** Fires left. */
  remaining: number;
  /** Next virtual time this should fire at. */
  next: number;
  action: () => void;
}

export class Clock {
  /** 1 = realtime, 0.5 = slow-mo, 2 = fast-forward. */
  timeScale = 1;

  private t = 0;
  private lastDelta = 0;
  private playing = true;
  private seq = 0;
  private events: TimelineEvent[] = [];

  /** Current virtual elapsed time, in seconds — the spine. */
  get now(): number {
    return this.t;
  }
  /** Virtual delta applied on the last `advance()` (already timeScale-scaled). */
  get delta(): number {
    return this.lastDelta;
  }
  get running(): boolean {
    return this.playing;
  }

  /** Advance the virtual clock by one real frame and fire any due cues. */
  advance(realDelta: number): void {
    if (!this.playing) {
      this.lastDelta = 0;
      return;
    }
    const vd = realDelta * this.timeScale;
    this.lastDelta = vd;
    const prev = this.t;
    this.t += vd;
    this.fireDue(prev, this.t);
  }

  pause(): void {
    this.playing = false;
  }
  resume(): void {
    this.playing = true;
  }
  toggle(): void {
    this.playing = !this.playing;
  }

  /** Restart the timeline at 0, re-arming every cue. Running state is kept. */
  reset(): void {
    this.t = 0;
    this.lastDelta = 0;
    for (const e of this.events) {
      this.armFrom(e, 0);
    }
  }

  /** Jump to `target`; re-arm future one-shots, mark passed ones as fired (no burst). */
  seek(target: number): void {
    this.t = target;
    this.lastDelta = 0;
    for (const e of this.events) {
      this.armFrom(e, target);
    }
  }

  schedule(at: number, action: () => void, opts: ScheduleOptions = {}): TimelineHandle {
    const id = opts.id ?? `evt:${this.seq++}`;
    // Replace any existing cue sharing this id (idempotent registration).
    this.cancel(id);
    const every = opts.every && opts.every > 0 ? opts.every : 0;
    const event: TimelineEvent = {
      id,
      base: at + (opts.offset ?? 0),
      every,
      repeatCap: every ? (opts.repeat ?? Number.POSITIVE_INFINITY) : 1,
      remaining: 0,
      next: 0,
      action,
    };
    this.armFrom(event, this.t);
    this.events.push(event);
    return { id, cancel: () => this.cancel(id) };
  }

  /** Sugar: fire every `interval` seconds, first fire at `interval`. */
  every(interval: number, action: () => void, opts: ScheduleOptions = {}): TimelineHandle {
    return this.schedule(interval, action, { ...opts, every: interval });
  }

  cancel(idOrHandle: string | TimelineHandle): void {
    const id = typeof idOrHandle === "string" ? idOrHandle : idOrHandle.id;
    this.events = this.events.filter((e) => e.id !== id);
  }

  clear(): void {
    this.events = [];
  }

  // Re-arm a cue relative to a virtual time `from`: compute how many fires have already passed
  // and where the next one lands strictly after `from`.
  private armFrom(e: TimelineEvent, from: number): void {
    // At/after `from` → armed (fires going forward); strictly before → consumed. The `>=` at the
    // boundary is what lets an `at:0` cue fire on the first frame.
    if (!e.every) {
      e.next = e.base;
      e.remaining = e.base >= from ? 1 : 0;
      return;
    }
    const passed = e.base >= from ? 0 : Math.floor((from - e.base) / e.every) + 1;
    e.next = e.base + passed * e.every;
    e.remaining = Math.max(0, e.repeatCap - passed);
  }

  private fireDue(_prev: number, current: number): void {
    let guard = 0;
    for (const e of this.events) {
      // `next` is always the smallest unfired time at/after the arm point, so `next <= current`
      // is the crossing test; bumping `next` prevents refires within the same frame.
      while (e.remaining > 0 && e.next <= current && guard++ < 4096) {
        e.action();
        e.remaining -= 1;
        if (e.every) {
          e.next += e.every;
        } else {
          e.next = Number.POSITIVE_INFINITY;
        }
      }
    }
  }
}
