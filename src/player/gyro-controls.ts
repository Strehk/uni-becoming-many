/**
 * Gyro flight controls — the phone's own tilt as the steering, for the mobile mode.
 *
 * Reports the same two axes the ICAROS orientation stream does, so it plugs into
 * `Player.update`'s `{ pitch, roll }` unchanged: an *integrating rate* pair, not an
 * absolute look. Hold the phone like a controller and tilt it —
 *
 *   - **tilt right/left** → `roll`: curves the heading, and the new course persists.
 *   - **tilt back/forward** → `pitch`: climbs / descends, like pulling a stick back.
 *     (Pull back to climb is the aeroplane convention; `invertPitch` flips it for
 *     anyone who reads the phone as a window instead of a yoke.)
 *
 * Three things make raw `deviceorientation` unusable without help, and this module
 * owns all three:
 *
 *   1. **Screen rotation.** `beta`/`gamma` are in *device* axes, which no longer
 *      match the screen once the phone is held in landscape. The readings are
 *      rotated by `screen.orientation.angle` into screen axes, so tilting "toward
 *      the right edge you can see" always turns right, portrait or landscape.
 *   2. **Neutral pose.** Nobody holds a phone flat. The first reading after
 *      `enable()` becomes the neutral pose, and `calibrate()` re-takes it — so the
 *      comfortable holding angle, whatever it is, means "fly straight".
 *   3. **Sensor noise.** The raw stream jitters by a degree or so at rest. A small
 *      dead zone plus the same frame-rate-independent spring the keyboard uses keeps
 *      the flight from twitching.
 *
 * iOS 13+ gates the sensor behind `DeviceOrientationEvent.requestPermission()`,
 * which only resolves when called from a user gesture — hence `enable()` returning
 * a promise, to be awaited straight out of the menu button's click handler.
 */

const DEG2RAD = Math.PI / 180;

/** Below this much tilt (degrees) off neutral, treat the phone as held still. */
const DEAD_ZONE_DEGREES = 2;

/** Spring rate toward the measured tilt, per second — matches the keyboard's feel. */
const STIFFNESS = 8;

export type GyroControlsOptions = Readonly<{
  /** Degrees of tilt that count as full deflection. Smaller = more sensitive. */
  rangeDegrees?: number;
  /** Flip the climb/descend direction. */
  invertPitch?: boolean;
}>;

/** Live steering, mutated in place — read it every frame, never cache the fields. */
type GyroSteering = { pitch: number; roll: number };

export interface GyroControls {
  /** The eased steering. Advance it with `update(dt)` before reading. */
  readonly steering: GyroSteering;
  /** True once permission is granted *and* a first tilt reading has arrived. */
  readonly active: boolean;
  /**
   * Ask for sensor access and start listening. Must be called from a user gesture
   * on iOS. Resolves false when the device has no sensor or the user declined —
   * the caller should then fall back to another control scheme.
   */
  enable(): Promise<boolean>;
  /** Stop listening (keeps the calibration for the next `enable`). */
  disable(): void;
  /** Take the current holding angle as the new neutral "fly straight" pose. */
  calibrate(): void;
  /** Retune the full-deflection angle live (the Einstellungen slider). */
  setRange(degrees: number): void;
  /** Flip the climb/descend direction live. */
  setInvertPitch(invert: boolean): void;
  /** Advance the spring toward the latest reading. Call once per frame. */
  update(dtSeconds: number): void;
  dispose(): void;
}

export function createGyroControls(options: GyroControlsOptions = {}): GyroControls {
  let range = Math.max(5, options.rangeDegrees ?? 30);
  let invertPitch = options.invertPitch === true;

  let listening = false;
  let hasReading = false;
  // Neutral pose, in screen-space tilt degrees; set from the first reading / calibrate().
  let neutralRight = 0;
  let neutralBack = 0;
  // Latest raw screen-space tilt, and the pending calibration request.
  let rawRight = 0;
  let rawBack = 0;
  let recalibrate = true;

  // Target deflection derived from the reading; `steering` springs toward it.
  const target = { pitch: 0, roll: 0 };
  const steering: GyroSteering = { pitch: 0, roll: 0 };

  /** Rotate the device-axis tilt into screen axes, so landscape steers like portrait. */
  const readTilt = (beta: number, gamma: number): void => {
    const angle = (screen.orientation?.angle ?? 0) * DEG2RAD;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    rawRight = gamma * cos + beta * sin; // + = the visible right edge dips
    rawBack = beta * cos - gamma * sin; // + = the visible top edge tips toward you
  };

  /** Tilt (degrees off neutral) → [-1, 1], with the dead zone taken out at the centre. */
  const normalize = (degrees: number): number => {
    const magnitude = Math.abs(degrees);
    if (magnitude <= DEAD_ZONE_DEGREES) {
      return 0;
    }
    // Re-span the remaining travel so the axis still reaches ±1 at full range.
    const usable = (magnitude - DEAD_ZONE_DEGREES) / Math.max(1, range - DEAD_ZONE_DEGREES);
    return Math.sign(degrees) * Math.min(1, usable);
  };

  const onOrientation = (event: DeviceOrientationEvent): void => {
    const { beta, gamma } = event;
    if (beta === null || gamma === null) {
      return; // a reading without absolute tilt tells us nothing
    }
    readTilt(beta, gamma);
    if (recalibrate) {
      neutralRight = rawRight;
      neutralBack = rawBack;
      recalibrate = false;
    }
    hasReading = true;

    target.roll = normalize(rawRight - neutralRight);
    const back = normalize(rawBack - neutralBack);
    target.pitch = invertPitch ? -back : back;
  };

  const start = (): void => {
    if (listening) {
      return;
    }
    window.addEventListener("deviceorientation", onOrientation);
    listening = true;
  };

  const stop = (): void => {
    if (!listening) {
      return;
    }
    window.removeEventListener("deviceorientation", onOrientation);
    listening = false;
    hasReading = false;
    target.pitch = 0;
    target.roll = 0;
    steering.pitch = 0;
    steering.roll = 0;
  };

  return {
    steering,

    get active(): boolean {
      return listening && hasReading;
    },

    async enable(): Promise<boolean> {
      if (typeof window.DeviceOrientationEvent === "undefined") {
        return false;
      }
      const gate = permissionGate();
      if (gate) {
        try {
          if ((await gate.requestPermission()) !== "granted") {
            return false;
          }
        } catch (error) {
          // Thrown when the call did not originate from a user gesture.
          console.warn("[gyro] orientation permission request failed", error);
          return false;
        }
      }
      recalibrate = true;
      start();
      return true;
    },

    disable(): void {
      stop();
    },

    calibrate(): void {
      recalibrate = true;
      target.pitch = 0;
      target.roll = 0;
    },

    setRange(degrees: number): void {
      range = Math.max(5, degrees);
    },

    setInvertPitch(invert: boolean): void {
      invertPitch = invert;
    },

    update(dtSeconds: number): void {
      if (dtSeconds <= 0) {
        return;
      }
      const factor = 1 - Math.exp(-STIFFNESS * dtSeconds);
      steering.roll += (target.roll - steering.roll) * factor;
      steering.pitch += (target.pitch - steering.pitch) * factor;
    },

    dispose(): void {
      stop();
    },
  };
}

/** iOS 13+ permission gate, when this browser has one. Typed guard — no cast. */
interface OrientationPermissionGate {
  requestPermission(): Promise<string>;
}

function permissionGate(): OrientationPermissionGate | null {
  const ctor: unknown = window.DeviceOrientationEvent;
  if (typeof ctor !== "function" || !("requestPermission" in ctor)) {
    return null;
  }
  const request: unknown = ctor.requestPermission;
  if (typeof request !== "function") {
    return null;
  }
  return {
    async requestPermission(): Promise<string> {
      const state: unknown = await request.call(ctor);
      return typeof state === "string" ? state : "denied";
    },
  };
}
