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
 *   1. **Screen rotation, and the Euler trap.** `beta`/`gamma` are device-axis Euler
 *      angles: they no longer match the screen once the phone is held in landscape,
 *      *and* that pose sits at their gimbal singularity. So the readings are first
 *      turned back into a gravity direction, then measured against the axes the
 *      viewer actually sees (`screen.orientation.angle`) — tilting "toward the right
 *      edge you can see" turns right, portrait or landscape, held flat or upright.
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
const RAD2DEG = 180 / Math.PI;

/** Below this much tilt (degrees) off neutral, treat the phone as held still. */
const DEAD_ZONE_DEGREES = 2;

/**
 * Climb/descend needs this much more tilt than turning does for the same deflection.
 * The wrist rolls sideways far more freely than it pitches fore-and-aft, so an axis
 * shared between them makes the vertical one feel hair-trigger — which is exactly how
 * it read at 1.0.
 */
const PITCH_RANGE_FACTOR = 1.8;

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

  /**
   * Turn one reading into two screen-space tilt angles, in degrees.
   *
   * Not from `beta`/`gamma` directly: those are Euler angles, and around the pose a
   * phone is actually held in — roughly upright, in landscape — they are near their
   * gimbal singularity, where a steady hand produces wild numbers and `gamma` folds
   * back at ±90°. The gravity direction has no such trouble, so we reconstruct it
   * from the angles first (the ZXY composition `deviceorientation` is defined in;
   * `alpha`, the compass, cancels out, as it must for a tilt) and read the tilt off
   * *that*:
   *
   *   • **bank** — how far gravity has swung toward the visible right edge, i.e. how
   *     far the phone is rolled like a steering wheel.
   *   • **pitch** — how far gravity has swung out of the screen plane, i.e. how far
   *     the visible top edge is pulled toward you.
   *
   * `asin` turns each component back into a real angle, so the response is linear in
   * degrees of tilt rather than compressing near the extremes.
   */
  const readTilt = (betaDegrees: number, gammaDegrees: number): void => {
    const beta = betaDegrees * DEG2RAD;
    const gamma = gammaDegrees * DEG2RAD;
    const cosBeta = Math.cos(beta);
    // Gravity (pointing down) expressed in device axes: x right, y top, z out of screen.
    const gx = cosBeta * Math.sin(gamma);
    const gy = -Math.sin(beta);
    const gz = -cosBeta * Math.cos(gamma);

    // The visible right edge in device axes, once the screen rotation is taken out.
    // `screen.orientation.angle` counts clockwise, so this is a plain +angle rotation
    // — the direction that was wrong before, which swapped left and right in landscape.
    const angle = (screen.orientation?.angle ?? 0) * DEG2RAD;
    const rightward = gx * Math.cos(angle) + gy * Math.sin(angle);

    rawRight = Math.asin(clampUnit(rightward)) * RAD2DEG; // + = right edge dips
    rawBack = Math.asin(clampUnit(gz)) * RAD2DEG; // + = top edge pulled toward you
  };

  /**
   * Tilt (degrees off neutral) → [-1, 1]: dead zone at the centre, then a
   * sign-preserving square. The curve is what makes the flight readable — linear
   * deflection turns every small hand tremor into a course change, while the square
   * leaves the middle calm and still reaches full deflection at the end of the travel.
   */
  const normalize = (degrees: number, fullDeflection: number): number => {
    const magnitude = Math.abs(degrees);
    if (magnitude <= DEAD_ZONE_DEGREES) {
      return 0;
    }
    // Re-span the remaining travel so the axis still reaches ±1 at full range.
    const usable = Math.min(
      1,
      (magnitude - DEAD_ZONE_DEGREES) / Math.max(1, fullDeflection - DEAD_ZONE_DEGREES),
    );
    return Math.sign(degrees) * usable * usable;
  };

  /**
   * Re-derive the target deflection from the last reading. Called on every reading
   * *and* whenever the tuning changes, so a slider moved in the menu is felt at once
   * rather than at the next sensor tick.
   */
  const recompute = (): void => {
    target.roll = normalize(rawRight - neutralRight, range);
    const back = normalize(rawBack - neutralBack, range * PITCH_RANGE_FACTOR);
    target.pitch = invertPitch ? -back : back;
  };

  const onOrientation = (event: DeviceOrientationEvent): void => {
    const { beta, gamma } = event;
    if (beta === null || gamma === null) {
      return; // a reading without tilt tells us nothing
    }
    readTilt(beta, gamma);
    if (recalibrate) {
      neutralRight = rawRight;
      neutralBack = rawBack;
      recalibrate = false;
    }
    hasReading = true;
    recompute();
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
      recompute();
    },

    setInvertPitch(invert: boolean): void {
      invertPitch = invert;
      recompute();
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

/** Keep a dot product inside asin's domain against floating-point drift. */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
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
