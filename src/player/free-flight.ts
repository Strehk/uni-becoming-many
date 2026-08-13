/**
 * Free-flight ("creative") controls — the configure-mode counterpart to the glider.
 *
 * The glider (see index.ts) is the piece's flight model: it always moves forward, steering is an
 * integrating rate, and altitude is bounded airspace. That is right for the experience and wrong
 * for *inspecting* one — so the operator screens fly like Minecraft's creative mode instead:
 * stand still, look wherever you want, move along your gaze.
 *
 *   - **W/S** forward / back along the view, **A/D** strafe level, **Space** up, **Shift** down.
 *     Nothing accumulates and nothing carries: release and you stop.
 *   - **Ctrl** boosts the speed while held.
 *   - **Looking** has three interchangeable modes (the dev panel switches them live, because each
 *     one trades away something different):
 *       · `pointerlock` — click the canvas to capture the cursor, ESC releases it. Closest to
 *         Minecraft, but the panels need the cursor back.
 *       · `drag` — look only while a mouse button is held. The cursor stays free for the panels.
 *       · `keys` — arrow keys turn and tilt. No mouse at all.
 *
 * Like the keyboard debug controls this module touches nothing else: it listens, and reports
 * intent through `input` (mutated in place). `Player.flyFree` is what acts on it.
 *
 * Space is swallowed while active (capture phase): it is the transport's pause key, and a creative
 * ascent should not scrub the timeline. **K** still pauses.
 */

/** How the view is aimed. See the module docs — the dev panel switches this live. */
export type LookMode = "pointerlock" | "drag" | "keys";

/**
 * The free-flight intent the frame loop reads. Mutated in place by `update`, so read it every
 * frame and never cache the fields.
 */
export type FreeFlightInput = {
  /** Along the view, -1..1 (forward positive). */
  forward: number;
  /** Level, across the view, -1..1 (right positive). */
  strafe: number;
  /** Straight up/down in world space, -1..1 (up positive). */
  lift: number;
  /** Yaw to apply THIS frame, radians (positive turns right). Consumed and recomputed per frame. */
  yawDelta: number;
  /** Absolute view pitch, radians (positive looks up). Persists between frames. */
  pitch: number;
  /** Speed multiplier (1 = base, `boost` while Ctrl is held). */
  boost: number;
};

export type FreeFlightOptions = Readonly<{
  /** Element the mouse look listens on — the WebGPU canvas. Defaults to `document.body`. */
  target?: HTMLElement;
  /** Where the key listeners attach. Defaults to `window`. */
  keyTarget?: Window | HTMLElement;
  /** Initial look mode. Defaults to "drag" — the one that leaves the panels usable. */
  lookMode?: LookMode;
  /** Radians of rotation per pixel of mouse travel. Defaults to 0.0022. */
  sensitivity?: number;
  /** Turn/tilt rate in the "keys" look mode, radians per second. Defaults to 1.6. */
  keyLookRate?: number;
  /** Speed multiplier while Ctrl is held. Defaults to 4. */
  boost?: number;
}>;

export interface FreeFlightControls {
  /** Live intent, mutated in place. Tick `update(dt)` first, then read. */
  readonly input: FreeFlightInput;
  /** Whether the controls are listening (only the configure mode turns them on). */
  readonly enabled: boolean;
  /** The current look mode. */
  readonly lookMode: LookMode;
  /** Arm or disarm. Disarming zeroes the intent and releases a captured cursor. */
  setEnabled(on: boolean): void;
  setLookMode(mode: LookMode): void;
  /** Fold the held keys and the frame's mouse travel into `input`. Once per frame, before reading. */
  update(dtSeconds: number): void;
  dispose(): void;
}

/** How far the view may tilt — just short of straight up/down, so it never gimbal-flips. */
const PITCH_LIMIT = 1.48; // ~85°

const FORWARD_KEYS: Readonly<Record<string, number>> = { KeyW: 1, KeyS: -1 };
const STRAFE_KEYS: Readonly<Record<string, number>> = { KeyD: 1, KeyA: -1 };
const LIFT_KEYS: Readonly<Record<string, number>> = {
  Space: 1,
  ShiftLeft: -1,
  ShiftRight: -1,
};
const YAW_KEYS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };
const PITCH_KEYS: Readonly<Record<string, number>> = { ArrowUp: 1, ArrowDown: -1 };

export function createFreeFlightControls(options: FreeFlightOptions = {}): FreeFlightControls {
  const target = options.target ?? document.body;
  const keyTarget: EventTarget = options.keyTarget ?? window;
  const sensitivity = options.sensitivity ?? 0.0022;
  const keyLookRate = options.keyLookRate ?? 1.6;
  const boostFactor = options.boost ?? 4;

  let lookMode: LookMode = options.lookMode ?? "drag";
  let enabled = false;
  let dragging = false;
  /** Mouse travel collected since the last `update`, in pixels. */
  let mouseX = 0;
  let mouseY = 0;

  const pressed = new Set<string>();
  const input: FreeFlightInput = {
    forward: 0,
    strafe: 0,
    lift: 0,
    yawDelta: 0,
    pitch: 0,
    boost: 1,
  };

  const axis = (keys: Readonly<Record<string, number>>): number => {
    let value = 0;
    for (const code in keys) {
      if (pressed.has(code)) {
        value += keys[code] ?? 0;
      }
    }
    return Math.max(-1, Math.min(1, value));
  };

  const isTyping = (): boolean => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };

  const bound = (code: string): boolean =>
    code in FORWARD_KEYS ||
    code in STRAFE_KEYS ||
    code in LIFT_KEYS ||
    code === "ControlLeft" ||
    code === "ControlRight" ||
    (lookMode === "keys" && (code in YAW_KEYS || code in PITCH_KEYS));

  const clearKeys = (): void => {
    pressed.clear();
    input.forward = 0;
    input.strafe = 0;
    input.lift = 0;
    input.yawDelta = 0;
    input.boost = 1;
  };

  // Capture phase: Space is the transport's pause key and Ctrl+key combinations are the browser's.
  // While free flight is armed those belong to the flight, so the event stops here.
  const onKeyDown = (event: Event): void => {
    if (!enabled || !(event instanceof KeyboardEvent) || isTyping()) {
      return;
    }
    if (!bound(event.code)) {
      return;
    }
    pressed.add(event.code);
    event.preventDefault(); // Space scrolls, arrows scroll
    if (event.code === "Space") {
      event.stopImmediatePropagation(); // …and would otherwise toggle the clock
    }
  };

  const onKeyUp = (event: Event): void => {
    if (event instanceof KeyboardEvent) {
      pressed.delete(event.code);
    }
  };

  // Dropping focus never delivers keyup — clear so nothing sticks down.
  const onBlur = (): void => clearKeys();

  // ── mouse look ──
  const locked = (): boolean => document.pointerLockElement === target;

  const onMouseDown = (event: MouseEvent): void => {
    if (!enabled) return;
    if (lookMode === "pointerlock") {
      if (!locked()) target.requestPointerLock();
      return;
    }
    if (lookMode === "drag") {
      dragging = true;
      event.preventDefault();
    }
  };

  const onMouseUp = (): void => {
    dragging = false;
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!enabled) return;
    const looking = lookMode === "pointerlock" ? locked() : lookMode === "drag" && dragging;
    if (!looking) return;
    mouseX += event.movementX;
    mouseY += event.movementY;
  };

  // Right-drag would otherwise open the context menu mid-look.
  const onContextMenu = (event: Event): void => {
    if (enabled && lookMode === "drag") event.preventDefault();
  };

  keyTarget.addEventListener("keydown", onKeyDown, true); // capture — see onKeyDown
  keyTarget.addEventListener("keyup", onKeyUp, true);
  keyTarget.addEventListener("blur", onBlur);
  target.addEventListener("mousedown", onMouseDown);
  target.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);

  const releasePointer = (): void => {
    if (locked()) document.exitPointerLock();
    dragging = false;
  };

  const update = (dtSeconds: number): void => {
    if (!enabled || dtSeconds <= 0) {
      return;
    }
    input.forward = axis(FORWARD_KEYS);
    input.strafe = axis(STRAFE_KEYS);
    input.lift = axis(LIFT_KEYS);
    input.boost = pressed.has("ControlLeft") || pressed.has("ControlRight") ? boostFactor : 1;

    // Mouse travel is per-event and already frame-independent; key looking is a rate.
    let yaw = mouseX * sensitivity;
    let pitch = input.pitch - mouseY * sensitivity;
    if (lookMode === "keys") {
      yaw += axis(YAW_KEYS) * keyLookRate * dtSeconds;
      pitch += axis(PITCH_KEYS) * keyLookRate * dtSeconds;
    }
    mouseX = 0;
    mouseY = 0;
    input.yawDelta = yaw;
    input.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  };

  return {
    input,
    get enabled() {
      return enabled;
    },
    get lookMode() {
      return lookMode;
    },
    setEnabled(on: boolean): void {
      if (enabled === on) return;
      enabled = on;
      clearKeys();
      if (!on) {
        releasePointer();
        input.pitch = 0; // hand the view back level, so the glider's gimbal starts clean
      }
    },
    setLookMode(mode: LookMode): void {
      if (lookMode === mode) return;
      releasePointer();
      lookMode = mode;
    },
    update,
    dispose(): void {
      releasePointer();
      keyTarget.removeEventListener("keydown", onKeyDown, true);
      keyTarget.removeEventListener("keyup", onKeyUp, true);
      keyTarget.removeEventListener("blur", onBlur);
      target.removeEventListener("mousedown", onMouseDown);
      target.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      pressed.clear();
    },
  };
}
