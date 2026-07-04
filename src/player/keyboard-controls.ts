/**
 * Keyboard debug controls — a self-contained override for the ICAROS orientation stream.
 *
 * Reads the keyboard and reports two spring-centered axes plus the flight modifiers:
 *   - `turn` — A/D: which way to curve the heading. Feed into `Player.update`'s `roll`; the
 *     player integrates it, so the turn persists (you can come about) and the spring only eases
 *     the curve in and out.
 *   - `pitch` — W/S: how far to tilt travel up/down. Feed into `Player.look`; the player treats
 *     it as an absolute offset, so on release the spring back to 0 re-levels (altitude kept).
 *
 * Both axes spring back to 0 when the keys release. Nothing here touches the player, renderer,
 * or ICAROS: it only listens for keys and reports intent, so it drops in anywhere and lifts out
 * again with a single `dispose()`. Tick `update(dtSeconds)` once per frame to advance the
 * spring before reading `locomotion`.
 *
 * Bindings:
 *   - W / ArrowUp, S / ArrowDown → pitch up / down
 *   - A / ArrowLeft, D / ArrowRight → turn left / right
 *   - Shift → hold for 2× flight speed
 *   - Space → toggle position hold (freeze translation; steering still springs)
 */

export type KeyboardControlsOptions = Readonly<{
  /** Where to attach listeners. Defaults to `window`. */
  target?: Window | HTMLElement;
  /** Throttle multiplier while Shift is held. Defaults to 2. */
  boost?: number;
  /**
   * Spring rate toward the target deflection, per second. Higher is snappier, lower is
   * looser/floatier. Frame-rate independent. Defaults to 10.
   */
  stiffness?: number;
}>;

/**
 * The debug input the frame loop reads. `pitch`/`turn` are normalized [-1, 1] spring-centered
 * axes (`pitch` up is +1, `turn` right is +1); `throttle`/`paused` are the flight modifiers.
 * Fields are writable — the module mutates one instance in place.
 */
type DebugInput = { pitch: number; turn: number; throttle: number; paused: boolean };

/** Below this magnitude, an un-pressed spring snaps to exactly 0 so ICAROS can retake control. */
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
   * detect a takeover and hand steering back to ICAROS once it releases and settles.
   */
  readonly steering: boolean;
  /** Advance the spring toward the current key targets. Call once per frame before reading. */
  update(dtSeconds: number): void;
  dispose(): void;
}

export function createKeyboardControls(options: KeyboardControlsOptions = {}): KeyboardControls {
  const target = options.target ?? window;
  const boost = options.boost ?? 2;
  const stiffness = options.stiffness ?? 10;

  const pressed = new Set<string>();
  let paused = false;

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
    locomotion.paused = paused; // discrete — no spring
  };

  // Frame-rate-independent exponential approach: same easing whether the frame is 8ms or 33ms.
  const spring = (current: number, goal: number, factor: number): number => {
    const next = current + (goal - current) * factor;
    return goal === 0 && Math.abs(next) < SETTLE_EPSILON ? 0 : next;
  };

  const update = (dtSeconds: number): void => {
    if (dtSeconds <= 0) {
      return;
    }
    const factor = 1 - Math.exp(-stiffness * dtSeconds);
    locomotion.pitch = spring(locomotion.pitch, target_.pitch, factor);
    locomotion.turn = spring(locomotion.turn, target_.turn, factor);
    locomotion.throttle = spring(locomotion.throttle, target_.throttle, factor);
  };

  const isBound = (code: string): boolean =>
    code in PITCH_KEYS ||
    code in TURN_KEYS ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "Space";

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isBound(event.code)) {
      return;
    }
    event.preventDefault(); // Space/arrows would otherwise scroll the page
    if (event.code === "Space") {
      if (!event.repeat) {
        paused = !paused; // toggle on the initial press, ignore auto-repeat
      }
    } else {
      pressed.add(event.code);
    }
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
