/**
 * Keyboard debug controls — a self-contained override for the M5 controller stream.
 *
 * Reads the keyboard and reports two spring-centered axes plus the flight modifiers:
 *   - `turn` — A/D: which way to curve the heading. Feed into `Player.update`'s `roll`; the
 *     player integrates it, so the turn persists (you can come about) and the spring only eases
 *     the curve in and out.
 *   - `pitch` — W/S: the ATTITUDE of the nose, held. Feed into `Player.look`; the player treats
 *     it as an absolute angle, and this module integrates it: the keys raise and lower the nose,
 *     and where you leave it is where it stays.
 *
 * The two axes behave alike on purpose, and it is the whole feel of the thing: a key sets a RATE
 * of change, and what it changes — course, attitude — persists once the key is let go. Nothing
 * self-corrects. Pitch used to spring back to level instead, which pulled the flight path
 * straight every time the hand left the key. Nothing here touches the player, renderer,
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
   * Spring rate back to centre once a TURN key is released, per second. Deliberately slower
   * than `stiffness` (defaults to 1.7): an aircraft settles out of a turn, it does not snap
   * out of it.
   */
  releaseStiffness?: number;
  /**
   * How fast W/S move the nose, in units of full deflection per second. Defaults to 0.9, so
   * about a second and a bit from level to the steepest climb — an elevator being wound in,
   * not a switch.
   */
  pitchRate?: number;
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
  const pitchRate = options.pitchRate ?? 0.9;

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
    // Turning eases at the rate its own direction of travel calls for: pushing into a
    // deflection is the pilot's intent and may arrive briskly, returning to centre is the
    // aircraft settling and takes its time.
    const held = factorFor(stiffness, dtSeconds);
    const releasing = factorFor(releaseStiffness, dtSeconds);
    locomotion.turn = spring(locomotion.turn, target_.turn, target_.turn === 0 ? releasing : held);
    locomotion.throttle = spring(locomotion.throttle, target_.throttle, held);

    // Pitch is INTEGRATED, not sprung: W and S wind the nose up and down, and it stays where
    // it is left — the same bargain the heading already makes. Clamped to full deflection so
    // the player's `lookAngle` still bounds how steep it can get.
    const pitchInput = target_.pitch;
    if (pitchInput !== 0) {
      locomotion.pitch = Math.max(
        -1,
        Math.min(1, locomotion.pitch + pitchInput * pitchRate * dtSeconds),
      );
    }
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
