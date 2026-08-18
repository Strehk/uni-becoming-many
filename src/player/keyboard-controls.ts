/**
 * Keyboard debug controls — a self-contained override for the M5 controller stream.
 *
 * Reads the keyboard and reports two spring-centered axes plus the flight modifiers:
 *   - `turn` — A/D: which way to curve the heading. Feed into `Player.update`'s `roll`; the
 *     player integrates it, so the turn persists (you can come about) and the spring only eases
 *     the curve in and out.
 *   - `pitch` — W/S: how far to tilt travel up/down. Feed into `Player.look`; the player treats
 *     it as an absolute offset, so on release the spring back to 0 re-levels (altitude kept).
 *
 * Both axes spring back to 0 when the keys release — slower than they left it, so the flight
 * settles out of a turn instead of snapping level. Nothing here touches the player, renderer,
 * or the controller: it only listens for keys and reports intent, so it drops in anywhere and
 * lifts out again with a single `dispose()`. Tick `update(dtSeconds)` once per frame to advance
 * the spring before reading `locomotion`.
 *
 * Bindings:
 *   - W / ArrowUp, S / ArrowDown → pitch up / down
 *   - A / ArrowLeft, D / ArrowRight → turn left / right
 *   - Shift → hold for 2× flight speed
 *
 * (Space is not a flight key — it pauses the timeline via the clock transport.)
 */

export type KeyboardControlsOptions = Readonly<{
  /** Where to attach listeners. Defaults to `window`. */
  target?: Window | HTMLElement;
  /** Throttle multiplier while Shift is held. Defaults to 2. */
  boost?: number;
  /**
   * Spring rate toward a HELD deflection, per second. Higher is snappier, lower is
   * looser/floatier. Frame-rate independent. Defaults to 3.2 — a glider's stick, not a
   * switch: about a third of a second to reach full deflection.
   */
  stiffness?: number;
  /**
   * Spring rate back to centre once the key is released, per second. Deliberately slower
   * than `stiffness` (defaults to 1.7): an aircraft settles out of a turn, it does not snap
   * level, and since pitch here aims the flight path itself, a hard return would kick the
   * whole trajectory. This asymmetry is most of what makes the keyboard feel flown rather
   * than pressed.
   */
  releaseStiffness?: number;
}>;

/**
 * The debug input the frame loop reads. `pitch`/`turn` are normalized [-1, 1] spring-centered
 * axes (`pitch` up is +1, `turn` right is +1); `throttle`/`paused` are the flight modifiers.
 * Fields are writable — the module mutates one instance in place.
 */
type DebugInput = { pitch: number; turn: number; throttle: number; paused: boolean };

/** Below this, an un-pressed spring snaps to exactly 0 so the controller can retake control. */
const SETTLE_EPSILON = 1e-3;

// Each steering key contributes a signed unit to one axis. Opposing keys held together cancel,
// so the resulting target stays in [-1, 1] without extra clamping.
const PITCH_KEYS: Readonly<Record<string, number>> = {
  KeyW: 1,
  ArrowUp: 1, // pitch up
  KeyS: -1,
  ArrowDown: -1, // pitch down
};
const TURN_KEYS: Readonly<Record<string, number>> = {
  KeyD: 1,
  ArrowRight: 1, // turn right
  KeyA: -1,
  ArrowLeft: -1, // turn left
};

export interface KeyboardControls {
  /**
   * Live debug input, mutated in place. Advanced by `update(dtSeconds)`, so tick that first —
   * read this every frame; never cache the field values.
   */
  readonly locomotion: DebugInput;
  /**
   * True while a key is held or a spring has not yet settled back to center — lets callers
   * detect a takeover and hand steering back to the controller once it releases and settles.
   */
  readonly steering: boolean;
  /** Advance the spring toward the current key targets. Call once per frame before reading. */
  update(dtSeconds: number): void;
  dispose(): void;
}

export function createKeyboardControls(options: KeyboardControlsOptions = {}): KeyboardControls {
  const target = options.target ?? window;
  const boost = options.boost ?? 2;
  const stiffness = options.stiffness ?? 3.2;
  const releaseStiffness = options.releaseStiffness ?? 1.7;

  const pressed = new Set<string>();

  // Target: instantaneous intent from the keys. `locomotion` springs toward it in `update`.
  const target_ = { pitch: 0, turn: 0, throttle: 1 };
  // Live, eased value the frame loop reads; mutated in place by `update`.
  const locomotion: DebugInput = { pitch: 0, turn: 0, throttle: 1, paused: false };

  const axis = (keys: Readonly<Record<string, number>>): number => {
    let value = 0;
    for (const code in keys) {
      if (pressed.has(code)) {
        value += keys[code] ?? 0;
      }
    }
    return Math.max(-1, Math.min(1, value));
  };

  const shiftHeld = (): boolean => pressed.has("ShiftLeft") || pressed.has("ShiftRight");
  const steeringHeld = (): boolean => target_.pitch !== 0 || target_.turn !== 0;

  // Recompute targets from key state. Cheap, so run on every key event; the spring in `update`
  // does the smoothing over time.
  const recompute = (): void => {
    target_.pitch = axis(PITCH_KEYS);
    target_.turn = axis(TURN_KEYS);
    target_.throttle = shiftHeld() ? boost : 1;
  };

  // Frame-rate-independent exponential approach: same easing whether the frame is 8ms or 33ms.
  const spring = (current: number, goal: number, factor: number): number => {
    const next = current + (goal - current) * factor;
    return goal === 0 && Math.abs(next) < SETTLE_EPSILON ? 0 : next;
  };

  /** Frame-rate-independent exponential approach at `rate` — same easing at 8 ms or 33 ms. */
  const factorFor = (rate: number, dtSeconds: number): number => 1 - Math.exp(-rate * dtSeconds);

  const update = (dtSeconds: number): void => {
    if (dtSeconds <= 0) {
      return;
    }
    // Each axis eases at the rate its own direction of travel calls for: pushing into a
    // deflection is the pilot's intent and may arrive briskly, returning to centre is the
    // aircraft settling and takes its time.
    const held = factorFor(stiffness, dtSeconds);
    const releasing = factorFor(releaseStiffness, dtSeconds);
    const rate = (goal: number): number => (goal === 0 ? releasing : held);
    locomotion.pitch = spring(locomotion.pitch, target_.pitch, rate(target_.pitch));
    locomotion.turn = spring(locomotion.turn, target_.turn, rate(target_.turn));
    locomotion.throttle = spring(locomotion.throttle, target_.throttle, held);
  };

  const isBound = (code: string): boolean =>
    code in PITCH_KEYS || code in TURN_KEYS || code === "ShiftLeft" || code === "ShiftRight";

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isBound(event.code)) {
      return;
    }
    event.preventDefault(); // arrows would otherwise scroll the page
    pressed.add(event.code);
    recompute();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (pressed.delete(event.code)) {
      recompute();
    }
  };

  // Dropping focus (e.g. Alt-Tab) never delivers keyup — clear state so keys don't stick.
  const onBlur = (): void => {
    pressed.clear();
    recompute();
  };

  const listener = target as EventTarget;
  listener.addEventListener("keydown", onKeyDown as EventListener);
  listener.addEventListener("keyup", onKeyUp as EventListener);
  listener.addEventListener("blur", onBlur);

  return {
    locomotion,
    update,
    get steering() {
      // Keep control while a key is held or a spring is still unwinding back to center.
      return steeringHeld() || locomotion.pitch !== 0 || locomotion.turn !== 0;
    },
    dispose() {
      listener.removeEventListener("keydown", onKeyDown as EventListener);
      listener.removeEventListener("keyup", onKeyUp as EventListener);
      listener.removeEventListener("blur", onBlur);
      pressed.clear();
    },
  };
}
