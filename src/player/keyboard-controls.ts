/**
 * Keyboard debug controls — a self-contained override for the M5 controller stream.
 *
 * Reads the keyboard and reports two spring-centered axes plus the flight modifiers:
 *   - `turn` — A/D: which way to curve the heading. Feed into `Player.update`'s `roll`; the
 *     player integrates it, so the turn persists (you can come about) and the spring only eases
 *     the curve in and out.
 *   - `pitch` — W/S: the nose. Feed into `Player.look`.
 *
 * How pitch behaves depends on `setDesktopFeel`. In the DESKTOP mode the keys set a RATE and the
 * attitude they reach PERSISTS — the same bargain the heading already makes, and the whole feel
 * of the thing: nothing self-corrects, so the flight path stops being pulled straight every time
 * the hand leaves the key. Everywhere else (the default) pitch springs back to level as before,
 * because there the keyboard is a debug aid and must not sit in the way of the rig or the phone.
 * Nothing here touches the player, renderer,
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
   * Roughly how long a control takes to reach a held deflection, in seconds. Defaults to
   * 0.55 — a glider's stick, not a switch.
   */
  holdTime?: number;
  /**
   * How long a control takes to come back to centre once released, in seconds. Deliberately
   * longer than `holdTime` (defaults to 0.9): an aircraft settles out of a turn, it does not
   * snap out of it.
   */
  releaseTime?: number;
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
   * Turn the desktop flying feel on or off.
   *
   * ON (the desktop mode): controls ease in and out over a good half second, and the nose
   * KEEPS the attitude it is left at — the same bargain the heading makes.
   *
   * OFF (the default, and what the ICAROS rig and the phone fly with): the old debug feel —
   * quick, and the nose springs back to level on release, so the keyboard cannot sit in the
   * way of the steering source that actually owns the flight.
   */
  setDesktopFeel(on: boolean): void;
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
  const desktopHold = options.holdTime ?? 0.55;
  const desktopRelease = options.releaseTime ?? 0.9;
  // The debug feel the other modes keep: quick, and the nose self-levels.
  const DEBUG_HOLD = 0.12;
  const DEBUG_RELEASE = 0.18;
  let desktopFeel = false;
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

  /**
   * Critically damped approach — the classic camera-move ease.
   *
   * An exponential approach (`x += (goal - x) * k`) reaches its top speed INSTANTLY: the
   * moment a key goes down the value is already moving at full rate, which is exactly the
   * jolt one sees. A critically damped spring carries a velocity, so it accelerates into the
   * move and decelerates out of it, and never overshoots. `smoothTime` is roughly how long
   * the move takes. Frame-rate independent (the closed form, not an Euler step).
   */
  const smoothDamp = (
    current: number,
    goal: number,
    state: { velocity: number },
    smoothTime: number,
    dtSeconds: number,
  ): number => {
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * dtSeconds;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - goal;
    const temp = (state.velocity + omega * change) * dtSeconds;
    state.velocity = (state.velocity - omega * temp) * decay;
    const next = goal + (change + temp) * decay;
    return goal === 0 && Math.abs(next) < SETTLE_EPSILON && Math.abs(state.velocity) < 0.05
      ? 0
      : next;
  };

  const turnState = { velocity: 0 };
  const pitchState = { velocity: 0 };
  const throttleState = { velocity: 0 };
  /** The eased elevator input; `locomotion.pitch` is its integral (the held attitude). */
  let pitchDrive = 0;

  const update = (dtSeconds: number): void => {
    if (dtSeconds <= 0) {
      return;
    }
    // Turning eases at the pace its own direction of travel calls for: rolling into a turn is
    // the pilot's intent and may arrive briskly, coming out of it is the aircraft settling and
    // takes its time.
    const holdTime = desktopFeel ? desktopHold : DEBUG_HOLD;
    const releaseTime = desktopFeel ? desktopRelease : DEBUG_RELEASE;
    locomotion.turn = smoothDamp(
      locomotion.turn,
      target_.turn,
      turnState,
      target_.turn === 0 ? releaseTime : holdTime,
      dtSeconds,
    );
    locomotion.throttle = smoothDamp(
      locomotion.throttle,
      target_.throttle,
      throttleState,
      holdTime,
      dtSeconds,
    );

    // The elevator itself is eased, and the ATTITUDE is its integral: W and S wind the nose up
    // and down, and it stays where it is left — the same bargain the heading already makes.
    // Easing the input rather than the angle is what keeps a climb from starting and stopping
    // with a snap. Clamped to full deflection, so the player's `lookAngle` still bounds how
    // steep it can get.
    pitchDrive = smoothDamp(
      pitchDrive,
      target_.pitch,
      pitchState,
      target_.pitch === 0 ? releaseTime : holdTime,
      dtSeconds,
    );
    if (desktopFeel) {
      if (pitchDrive !== 0) {
        locomotion.pitch = Math.max(
          -1,
          Math.min(1, locomotion.pitch + pitchDrive * pitchRate * dtSeconds),
        );
      }
    } else {
      // Debug feel: the eased input IS the attitude, so letting go re-levels and the keyboard
      // hands the flight straight back to whatever else is steering.
      locomotion.pitch = pitchDrive;
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

    setDesktopFeel(on: boolean): void {
      desktopFeel = on;
    },

    get steering() {
      // Hold control while a key is down and while the springs are still unwinding. In the
      // desktop feel a held attitude counts too — it is the keyboard's, and handing over
      // mid-climb would have another source fight it; levelling out gives the flight back.
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
