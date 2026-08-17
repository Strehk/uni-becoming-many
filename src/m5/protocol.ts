/**
 * M5 wire formats — the two boundaries the bridge sits between.
 *
 *   1. **Device frames** (`DeviceFrame`): newline-free JSON the M5StickC Plus2 firmware sends
 *      over `ws://<bridge>:5184/ws/device`. Shapes come from the firmware itself
 *      (`firmware/m5-controller/src/main.cpp`, `sendRegisterFrame` / `sendHeartbeatFrame` /
 *      `sendOrientationFrame`): `pitch`/`roll` are **degrees** off level, straight out of an
 *      accelerometer-only estimate.
 *   2. **Control frames** (`ControlFrame`): what the pipeline publishes to browsers over
 *      `/ws/m5` — normalized, calibrated, safety-clamped. Nothing downstream ever sees a raw
 *      device frame.
 *
 * Everything arriving from a socket is `unknown` until a guard here narrows it. Frames are
 * narrowed into shapes whose fields are declared-optional `unknown` rather than an index
 * signature, so member access satisfies `noPropertyAccessFromIndexSignature` without bracket
 * keys — the same discipline the previous ICAROS client used.
 *
 * Ported from dweigend/Icaros_Host (`src/lib/protocol`, `src/lib/server/control/normalizer.ts`).
 */

/** Normalized controller state. The only controller shape that leaves the bridge. */
export type ControlFrame = Readonly<{
  /** Forward/backward inclination, -1..1. Positive climbs. */
  pitch: number;
  /** Left/right inclination, -1..1. */
  roll: number;
  /** Signal strength, 0..1. **0 means "neutral", not "broken"** — see `createNeutralControl`. */
  quality: number;
  buttonPressed: boolean;
  /** True on the single frame the button went down. */
  buttonDown: boolean;
  /** True on the single frame the button came back up. */
  buttonUp: boolean;
  controllerType: "m5";
}>;

/**
 * A raw firmware frame. Every field is optional: the firmware sends three different frame types
 * over one socket, and older/other controller firmwares name the axes differently.
 *
 * `angleX`/`angleY`/`rotationX`/`rotationY` are aliases kept from the host's normalizer so a
 * controller flashed with older firmware still steers. The firmware in this project's sibling
 * repo sends `pitch`/`roll`.
 */
export type DeviceFrame = Readonly<{
  type?: unknown;
  deviceId?: unknown;
  role?: unknown;
  firmwareVersion?: unknown;
  pitch?: unknown;
  roll?: unknown;
  angleX?: unknown;
  angleY?: unknown;
  rotationX?: unknown;
  rotationY?: unknown;
  /** Device clock in ms. Only frames that carry it can be judged stale. */
  timestamp?: unknown;
  quality?: unknown;
  buttonPressed?: unknown;
  buttonDown?: unknown;
  buttonUp?: unknown;
}>;

/** What the bridge pushes to every connected browser. */
export type BridgeMessage =
  | Readonly<{ type: "control"; control: ControlFrame }>
  | Readonly<{ type: "state"; state: BridgeState }>;

/** Operator-visible bridge state, mirrored into the dev console. */
export type BridgeState = Readonly<{
  /** True while a paired M5 socket is open. */
  deviceConnected: boolean;
  /** Milliseconds since the last orientation frame, or null if none has arrived yet. */
  lastFrameAgoMs: number | null;
  calibration: Readonly<{ pitchOffset: number; rollOffset: number; calibratedAt: string | null }>;
  axisMap: AxisMap;
}>;

/** What a browser may ask the bridge to do. Steering is read-only; only tuning flows back. */
export type BridgeCommand =
  | Readonly<{ type: "calibrate" }>
  | Readonly<{ type: "calibrate.reset" }>
  | Readonly<{ type: "axis"; field: AxisMapField; enabled: boolean }>;

/**
 * Mount correction. The M5 is physically strapped to the flight rig, so its axes may be
 * exchanged or reversed relative to the logical output frame.
 */
export type AxisMap = Readonly<{
  swapPitchRoll: boolean;
  invertPitch: boolean;
  invertRoll: boolean;
}>;

export type AxisMapField = "swapPitchRoll" | "invertPitch" | "invertRoll";

export const AXIS_MAP_FIELDS: readonly AxisMapField[] = [
  "swapPitchRoll",
  "invertPitch",
  "invertRoll",
];

export const NEUTRAL_AXIS_MAP: AxisMap = {
  swapPitchRoll: false,
  invertPitch: false,
  invertRoll: false,
};

/**
 * The at-rest control. Published whenever input is missing, stale, implausible or unsafe —
 * `quality: 0` is the caller's cue that nothing is steering, and is a normal operating state
 * (keyboard control, controller not yet paired), not an error.
 */
export function createNeutralControl(): ControlFrame {
  return {
    pitch: 0,
    roll: 0,
    quality: 0,
    buttonPressed: false,
    buttonDown: false,
    buttonUp: false,
    controllerType: "m5",
  };
}

// --- Guards: external data stays `unknown` until it has been checked. --------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one device socket message. Returns null for anything that is not a JSON object. */
export function parseDeviceFrame(rawValue: string): DeviceFrame | null {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    // Every `DeviceFrame` field is an optional `unknown`, so a plain record satisfies it without
    // asserting anything about the values — the pipeline narrows each one where it reads it.
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAxisMapField(value: unknown): value is AxisMapField {
  return typeof value === "string" && AXIS_MAP_FIELDS.includes(value as AxisMapField);
}

/** Parse one browser→bridge command. Returns null for anything unrecognized. */
export function parseBridgeCommand(rawValue: string): BridgeCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const type = parsed["type"];
  if (type === "calibrate" || type === "calibrate.reset") {
    return { type };
  }
  if (type !== "axis") {
    return null;
  }

  const field = parsed["field"];
  const enabled = parsed["enabled"];
  if (!isAxisMapField(field) || typeof enabled !== "boolean") {
    return null;
  }
  return { type: "axis", field, enabled };
}

/** Parse one bridge→browser message. Returns null for anything unrecognized. */
export function parseBridgeMessage(rawValue: string): BridgeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed["type"] === "control") {
    const control = parsed["control"];
    return isControlFrame(control) ? { type: "control", control } : null;
  }
  if (parsed["type"] === "state") {
    const state = parsed["state"];
    return isBridgeState(state) ? { type: "state", state } : null;
  }
  return null;
}

function isControlFrame(value: unknown): value is ControlFrame {
  return (
    isRecord(value) &&
    typeof value["pitch"] === "number" &&
    typeof value["roll"] === "number" &&
    typeof value["quality"] === "number" &&
    typeof value["buttonPressed"] === "boolean" &&
    typeof value["buttonDown"] === "boolean" &&
    typeof value["buttonUp"] === "boolean" &&
    value["controllerType"] === "m5"
  );
}

function isBridgeState(value: unknown): value is BridgeState {
  if (!isRecord(value)) {
    return false;
  }
  const calibration = value["calibration"];
  const axisMap = value["axisMap"];
  return (
    typeof value["deviceConnected"] === "boolean" &&
    isRecord(calibration) &&
    typeof calibration["pitchOffset"] === "number" &&
    typeof calibration["rollOffset"] === "number" &&
    isRecord(axisMap) &&
    typeof axisMap["swapPitchRoll"] === "boolean" &&
    typeof axisMap["invertPitch"] === "boolean" &&
    typeof axisMap["invertRoll"] === "boolean"
  );
}
