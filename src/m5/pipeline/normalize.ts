/**
 * Device frame → normalized control. The bridge's boundary between firmware-shaped data and
 * the public control contract.
 *
 * Rejects missing or stale orientation with a neutral control, converts pitch/roll from
 * **degrees** into -1..1 over a ±45° working range, clamps quality into 0..1, and optionally
 * eases consecutive controls so a resumed stream does not snap.
 *
 * Ported verbatim (logic and constants) from dweigend/Icaros_Host
 * `src/lib/server/control/normalizer.ts`. The constants are tuned to the physical rig — see
 * `docs/m5-bridge.md` before changing one.
 */
import { type ControlFrame, type DeviceFrame, createNeutralControl } from "../protocol.ts";

/** A frame carrying its own timestamp is ignored once it is this old. */
export const STALE_AFTER_MS = 1_000;

/**
 * Full-scale tilt. 45° of physical lean maps to ±1, so the rider does not have to reach the
 * mechanical limit of the rig to get full control authority.
 */
const MAX_ANGLE_DEGREES = 45;

/** Per-frame easing toward the newest value. 1 would be no smoothing at all. */
const DEFAULT_SMOOTHING = 0.25;

type OrientationDegrees = Readonly<{ pitch: number; roll: number }>;

export function normalizeDeviceFrame(frame: DeviceFrame, now: number = Date.now()): ControlFrame {
  if (isStale(frame, now)) {
    return createNeutralControl();
  }

  const orientation = readOrientationDegrees(frame);
  if (orientation === null) {
    return createNeutralControl();
  }

  return {
    pitch: clamp(orientation.pitch / MAX_ANGLE_DEGREES, -1, 1),
    roll: clamp(orientation.roll / MAX_ANGLE_DEGREES, -1, 1),
    quality: readQuality(frame.quality),
    buttonPressed: frame.buttonPressed === true,
    buttonDown: frame.buttonDown === true,
    buttonUp: frame.buttonUp === true,
    controllerType: "m5",
  };
}

/**
 * Ease `previous` toward `next`. A control that carries no signal (`quality <= 0`) passes
 * through untouched — neutral must land immediately, never fade in.
 */
export function smoothControl(
  previous: ControlFrame,
  next: ControlFrame,
  smoothing: number = DEFAULT_SMOOTHING,
  enabled = true,
): ControlFrame {
  if (!enabled || next.quality <= 0) {
    return next;
  }

  const amount = Number.isFinite(smoothing) ? clamp(smoothing, 0, 1) : DEFAULT_SMOOTHING;
  // A previously-neutral control eases from true zero rather than from its stale pose.
  const previousPitch = previous.quality <= 0 ? 0 : previous.pitch;
  const previousRoll = previous.quality <= 0 ? 0 : previous.roll;

  return {
    ...next,
    pitch: lerp(previousPitch, next.pitch, amount),
    roll: lerp(previousRoll, next.roll, amount),
  };
}

/** True when a frame carries usable orientation — heartbeats and register frames do not. */
export function isOrientationFrame(frame: DeviceFrame): boolean {
  return readOrientationDegrees(frame) !== null;
}

function readOrientationDegrees(frame: DeviceFrame): OrientationDegrees | null {
  const pitch = firstFiniteNumber(frame.pitch, frame.angleY, frame.rotationY);
  const roll = firstFiniteNumber(frame.roll, frame.angleX, frame.rotationX);
  return pitch === null || roll === null ? null : { pitch, roll };
}

/**
 * Only frames that carry their own `timestamp` can be judged stale here; the firmware in this
 * project does not send one, so a quiet device is caught by the bridge's stale timer instead.
 */
function isStale(frame: DeviceFrame, now: number): boolean {
  return typeof frame.timestamp === "number" && now - frame.timestamp > STALE_AFTER_MS;
}

function firstFiniteNumber(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/** A frame that omits quality is trusted (1); a present value is clamped into range. */
function readQuality(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
