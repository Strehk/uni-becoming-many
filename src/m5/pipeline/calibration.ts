/**
 * Neutral-pose calibration in public -1..1 units.
 *
 * The rig does not rest at level, and the mount is never perfectly square. Rather than a
 * hard-coded bias constant in the flight code, the operator puts the rig in its rest pose and
 * presses "calibrate": the current control becomes the new zero, and every later control is
 * shifted by that offset.
 *
 * Offsets live in the *public* unit range, never in raw sensor terms — nothing about the
 * device's internals leaks past this module.
 *
 * Ported from dweigend/Icaros_Host `src/lib/server/control/calibration.ts`, with the module
 * globals and file I/O replaced by an injected store (see `store.ts`) so the pipeline stays
 * testable and this repo keeps its "no shared globals" module rule.
 */
import { type ControlFrame, createNeutralControl } from "../protocol.ts";

export type Calibration = Readonly<{
  pitchOffset: number;
  rollOffset: number;
  /** ISO timestamp of the last calibration, or null if never calibrated. */
  calibratedAt: string | null;
}>;

export type CalibrationResult =
  | Readonly<{ ok: true; calibration: Calibration }>
  | Readonly<{ ok: false; message: string }>;

export const NEUTRAL_CALIBRATION: Calibration = {
  pitchOffset: 0,
  rollOffset: 0,
  calibratedAt: null,
};

export interface Calibrator {
  readonly calibration: Calibration;
  /** True when the offsets actually shift anything. */
  readonly isActive: boolean;
  /** True while a usable live pose is available to calibrate against. */
  readonly hasLivePose: boolean;
  /** Remember `control` as the current pose and return it calibrated. */
  record(control: ControlFrame): ControlFrame;
  /** Forget the live pose — call when the device goes quiet, so a stale pose is never captured. */
  clearLivePose(): void;
  /** Adopt the current live pose as the new zero. */
  calibrateCurrentPose(now?: Date): CalibrationResult;
  reset(): Calibration;
}

export type CalibratorOptions = Readonly<{
  calibration?: Calibration;
  /** Called whenever the calibration changes — the bridge persists and re-publishes on this. */
  onChange?: (calibration: Calibration) => void;
}>;

export function createCalibrator(options: CalibratorOptions = {}): Calibrator {
  let calibration = options.calibration ?? NEUTRAL_CALIBRATION;
  let livePose: ControlFrame | null = null;

  const setCalibration = (next: Calibration): void => {
    calibration = next;
    options.onChange?.(next);
  };

  return {
    get calibration(): Calibration {
      return calibration;
    },
    get isActive(): boolean {
      return calibration.pitchOffset !== 0 || calibration.rollOffset !== 0;
    },
    get hasLivePose(): boolean {
      return livePose !== null;
    },
    record(control: ControlFrame): ControlFrame {
      // A signal-less control is not a pose — calibrating against it would zero the rig blind.
      livePose = control.quality > 0 ? control : null;
      return applyCalibration(control, calibration);
    },
    clearLivePose(): void {
      livePose = null;
    },
    calibrateCurrentPose(now: Date = new Date()): CalibrationResult {
      if (livePose === null) {
        return { ok: false, message: "Kein Live-Signal vom Controller — nichts zu kalibrieren." };
      }
      const next: Calibration = {
        pitchOffset: clampUnit(livePose.pitch),
        rollOffset: clampUnit(livePose.roll),
        calibratedAt: now.toISOString(),
      };
      setCalibration(next);
      return { ok: true, calibration: next };
    },
    reset(): Calibration {
      setCalibration(NEUTRAL_CALIBRATION);
      return calibration;
    },
  };
}

/**
 * Shift a control by the calibration offsets. A neutral control stays exactly neutral: offsets
 * must never manufacture steering out of "no signal".
 */
export function applyCalibration(control: ControlFrame, calibration: Calibration): ControlFrame {
  if (control.quality <= 0) {
    return createNeutralControl();
  }

  return {
    ...control,
    pitch: clampUnit(control.pitch - calibration.pitchOffset),
    roll: clampUnit(control.roll - calibration.rollOffset),
  };
}

/** Narrow a persisted value back into a calibration, or null if it is unusable. */
export function readCalibration(input: unknown): Calibration | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const candidate = input as Readonly<Record<string, unknown>>;
  const pitchOffset = readUnit(candidate["pitchOffset"]);
  const rollOffset = readUnit(candidate["rollOffset"]);
  if (pitchOffset === null || rollOffset === null) {
    return null;
  }
  const calibratedAt = candidate["calibratedAt"];
  return {
    pitchOffset,
    rollOffset,
    calibratedAt: typeof calibratedAt === "string" ? calibratedAt : null,
  };
}

function readUnit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clampUnit(value) : null;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
