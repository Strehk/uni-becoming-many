import type { Bus } from "../signals/index.ts";
/**
 * Audio — renderer-agnostic Web Audio, wired to the substrate (docs §6, P4).
 *
 * Two layers:
 *   - {@link SoundBus}      — low-level: AudioContext, master chain, clip load/decode cache,
 *                             gesture unlock, play/stop with fades. Flat stereo.
 *   - {@link SoundDirector} — ties the bus to the time spine + event bus via *cues*. A cue is a
 *                             sound plus a trigger:
 *                               • `time`  → scheduled on the {@link Clock}, so it obeys
 *                                 pause/seek/timeScale (frame-accurate, re-armed on seek).
 *                               • `event` → played whenever anyone emits `cue:<id>` on the bus, so
 *                                 *why* it fires (proximity, sense change, a creature's decision) is
 *                                 fully decoupled from the sound itself.
 *
 * Concept-ported from neural-flight-template's `audio.ts`; the clock/trigger machinery is
 * re-expressed onto this repo's {@link Clock} + {@link Bus} instead of a bespoke director.
 */
import type { Clock } from "../time/clock.ts";

// ── SoundBus ───────────────────────────────────────────────────

export interface SoundDef {
  id: string;
  /** URL of the audio file. */
  src: string;
  /** Playback gain 0..1 (default 1). */
  gain?: number;
  /** Loop the clip (default false). */
  loop?: boolean;
  /** Fade-in seconds on play (default 0). */
  fadeIn?: number;
  /** Default fade-out seconds on stop (default 0). */
  fadeOut?: number;
  /**
   * Honour a {@link SoundBus.play} that arrived before the buffer finished decoding, even for a
   * one-shot (loops already do this). Set for long *sustained* clips (e.g. the timeline movements)
   * whose start moment is authored, so a still-decoding buffer starts as soon as it's ready instead
   * of silently missing its cue. Off by default so a late-decoding chirp can't fire past its moment.
   */
  deferPlay?: boolean;
}

interface LoadedSound {
  def: SoundDef;
  buffer: AudioBuffer | null;
  /** play() was called before the buffer finished decoding. */
  wantsPlay: boolean;
  /** Live source/gain pairs (loops + still-ringing one-shots), for stop(). */
  active: { source: AudioBufferSourceNode; gain: GainNode }[];
}

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class SoundBus {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly sounds = new Map<string, LoadedSound>();
  private readonly unlockEvents = ["pointerdown", "keydown", "touchend"] as const;
  private readonly onUnlock = (): void => {
    void this.resume();
    this.detachUnlock();
  };
  private unlockAttached = false;

  constructor(opts: { masterGain?: number } = {}) {
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) {
      this.ctx = null;
      this.master = null;
      return;
    }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = opts.masterGain ?? 0.8;
    // Gentle headroom so layered clips never hard-clip.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // Browsers start the context suspended until a user gesture.
    this.attachUnlock();
  }

  /** Register a clip and kick off its async load + decode. */
  define(def: SoundDef): void {
    if (!this.ctx || this.sounds.has(def.id)) {
      return;
    }
    const entry: LoadedSound = { def, buffer: null, wantsPlay: false, active: [] };
    this.sounds.set(def.id, entry);
    void this.loadBuffer(entry);
  }

  /** Play a clip now. If still loading, a loop will start once it's ready. */
  play(id: string): void {
    const entry = this.sounds.get(id);
    if (!entry || !this.ctx || !this.master) {
      return;
    }
    if (!entry.buffer) {
      entry.wantsPlay = true; // resolved on load (loops only — see loadBuffer)
      return;
    }
    this.start(entry);
  }

  stop(id: string, fadeOut?: number): void {
    const entry = this.sounds.get(id);
    if (!entry || !this.ctx) {
      return;
    }
    entry.wantsPlay = false;
    const fade = fadeOut ?? entry.def.fadeOut ?? 0;
    const now = this.ctx.currentTime;
    for (const { source, gain } of entry.active) {
      if (fade > 0) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        source.stop(now + fade);
      } else {
        source.stop();
      }
    }
  }

  setMasterGain(v: number): void {
    if (this.master) {
      this.master.gain.value = v;
    }
  }

  /**
   * Set the live playback gain of a sound's currently-ringing source(s) — the hook a continuous
   * volume *envelope* drives (e.g. Theatre-authored movement tracks). Smoothed with
   * `setTargetAtTime` so per-frame updates don't zipper. No-op if the clip isn't playing yet
   * (its buffer may still be decoding), which is fine: the envelope keeps calling until it is.
   */
  setGain(id: string, value: number): void {
    const entry = this.sounds.get(id);
    if (!entry || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    for (const { gain } of entry.active) {
      gain.gain.setTargetAtTime(Math.max(0, value), now, 0.02);
    }
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  dispose(): void {
    this.detachUnlock();
    for (const entry of this.sounds.values()) {
      for (const { source } of entry.active) {
        try {
          source.stop();
        } catch {
          // already stopped — ignore
        }
      }
      entry.active = [];
    }
    this.sounds.clear();
    void this.ctx?.close();
  }

  private start(entry: LoadedSound): void {
    if (!this.ctx || !this.master || !entry.buffer) {
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = entry.buffer;
    source.loop = entry.def.loop ?? false;

    const gain = this.ctx.createGain();
    const targetGain = entry.def.gain ?? 1;
    const fadeIn = entry.def.fadeIn ?? 0;
    const now = this.ctx.currentTime;
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(targetGain, now + fadeIn);
    } else {
      gain.gain.value = targetGain;
    }

    source.connect(gain);
    gain.connect(this.master);
    source.start();

    const pair = { source, gain };
    entry.active.push(pair);
    source.onended = (): void => {
      entry.active = entry.active.filter((p) => p !== pair);
    };
  }

  private async loadBuffer(entry: LoadedSound): Promise<void> {
    if (!this.ctx) {
      return;
    }
    try {
      const res = await fetch(entry.def.src);
      const data = await res.arrayBuffer();
      entry.buffer = await this.ctx.decodeAudioData(data);
      // Honour a play() that arrived before decode finished — loops and opt-in `deferPlay` clips
      // (the sustained timeline movements), so a late-decoding one-shot chirp can't fire long
      // after its moment while an authored movement still starts as soon as it's ready.
      if (entry.wantsPlay && (entry.def.loop || entry.def.deferPlay)) {
        entry.wantsPlay = false;
        this.start(entry);
      }
    } catch (err) {
      console.warn(`[audio] failed to load ${entry.def.src}`, err);
    }
  }

  private attachUnlock(): void {
    if (this.unlockAttached || typeof window === "undefined") {
      return;
    }
    for (const ev of this.unlockEvents) {
      window.addEventListener(ev, this.onUnlock, { once: false });
    }
    this.unlockAttached = true;
  }

  private detachUnlock(): void {
    if (!this.unlockAttached || typeof window === "undefined") {
      return;
    }
    for (const ev of this.unlockEvents) {
      window.removeEventListener(ev, this.onUnlock);
    }
    this.unlockAttached = false;
  }
}

// ── SoundDirector ──────────────────────────────────────────────

export type Trigger =
  | {
      /** Played whenever anyone emits `cue:<id>` on the event bus. */
      kind: "event";
    }
  | {
      /** Scheduled on the clock: seconds since the spine started. */
      kind: "time";
      at: number;
      offset?: number;
      every?: number;
      repeat?: number;
    };

export interface CueDef extends SoundDef {
  trigger: Trigger;
}

export class SoundDirector {
  private readonly bus: SoundBus;
  private readonly clock: Clock;
  private readonly events: Bus;
  private readonly unsubscribes: (() => void)[] = [];

  constructor(bus: SoundBus, clock: Clock, events: Bus) {
    this.bus = bus;
    this.clock = clock;
    this.events = events;
  }

  /** Wire a sound to a trigger. Time cues schedule on the clock; event cues subscribe to the bus. */
  cue(def: CueDef): void {
    const { trigger, ...sound } = def;
    this.bus.define(sound);
    if (trigger.kind === "time") {
      this.clock.schedule(trigger.at, () => this.bus.play(sound.id), {
        id: `cue:${sound.id}`,
        ...(trigger.offset === undefined ? {} : { offset: trigger.offset }),
        ...(trigger.every === undefined ? {} : { every: trigger.every }),
        ...(trigger.repeat === undefined ? {} : { repeat: trigger.repeat }),
      });
    } else {
      this.unsubscribes.push(this.events.on(`cue:${sound.id}`, () => this.bus.play(sound.id)));
    }
  }

  stop(id: string, fadeOut?: number): void {
    this.bus.stop(id, fadeOut);
  }

  setMasterGain(v: number): void {
    this.bus.setMasterGain(v);
  }

  dispose(): void {
    for (const off of this.unsubscribes) {
      off();
    }
    this.unsubscribes.length = 0;
    this.bus.dispose();
  }
}
