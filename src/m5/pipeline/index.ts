/**
 * The control pipeline — one device frame in, one published control out.
 *
 * Stage order is load-bearing and matches the host it was ported from
 * (`Icaros_Host/src/lib/server/ws/gateway.ts:335-353`):
 *
 *   normalize → axis-map → calibrate → safety → auto-neutralize → smooth
 *
 * Axis mapping runs *before* calibration so a recorded neutral pose is stored in the corrected
 * frame. Smoothing runs last and is skipped while the neutralizer holds the rig at zero, so
 * "parked" does not slowly drift.
 *
 * The pipeline owns the small amount of state this needs (last published control, last
 * normalized control, when the last frame arrived) but no sockets, no files and no globals:
 * persistence is the caller's job via `onCalibrationChange` / `onAxisMapChange`.
 */
import {
  type AxisMap,
  type AxisMapField,
  type BridgeState,
  type ControlFrame,
  NEUTRAL_AXIS_MAP,
  createNeutralControl,
  parseDeviceFrame,
} from "../protocol.ts";
import { type AutoNeutralizer, createAutoNeutralizer } from "./auto-neutralize.ts";
import { applyAxisMap } from "./axis-map.ts";
import {
  type Calibration,
  type CalibrationResult,
  type Calibrator,
  NEUTRAL_CALIBRATION,
  applyCalibration,
  createCalibrator,
} from "./calibration.ts";
import {
  STALE_AFTER_MS,
  isOrientationFrame,
  normalizeDeviceFrame,
  smoothControl,
} from "./normalize.ts";
import { protectControl } from "./safety.ts";

export type ControlPipelineOptions = Readonly<{
  /** Called for every published control — including the neutral ones. */
  onControl: (control: ControlFrame) => void;
  /** Called whenever operator-visible state changes (device presence, calibration, axis map). */
  onState?: (state: BridgeState) => void;
  calibration?: Calibration;
  axisMap?: AxisMap;
  onCalibrationChange?: (calibration: Calibration) => void;
  onAxisMapChange?: (axisMap: AxisMap) => void;
}>;

export interface ControlPipeline {
  /** The most recently published control. */
  readonly control: ControlFrame;
  readonly state: BridgeState;
  /** Feed one raw device socket message. */
  ingest(rawValue: string, now?: number): void;
  /** Report whether a paired device socket is currently open. */
  setDeviceConnected(connected: boolean): void;
  /** Drive the stale check. Call a few times a second. */
  tick(now?: number): void;
  /** Adopt the current live pose as neutral. */
  calibrate(now?: Date): CalibrationResult;
  resetCalibration(): void;
  setAxisField(field: AxisMapField, enabled: boolean): void;
}

export function createControlPipeline(options: ControlPipelineOptions): ControlPipeline {
  const neutralizer: AutoNeutralizer = createAutoNeutralizer();
  let axisMap: AxisMap = options.axisMap ?? NEUTRAL_AXIS_MAP;
  let control: ControlFrame = createNeutralControl();
  let lastNormalized: ControlFrame | null = null;
  let lastFrameAtMs: number | null = null;
  let deviceConnected = false;

  const calibrator: Calibrator = createCalibrator({
    calibration: options.calibration ?? NEUTRAL_CALIBRATION,
    onChange: (next) => options.onCalibrationChange?.(next),
  });

  const readState = (now: number): BridgeState => ({
    deviceConnected,
    lastFrameAgoMs: lastFrameAtMs === null ? null : Math.max(0, now - lastFrameAtMs),
    calibration: calibrator.calibration,
    axisMap,
  });

  const emitState = (now: number = Date.now()): void => {
    options.onState?.(readState(now));
  };

  const publish = (next: ControlFrame): void => {
    control = next;
    options.onControl(next);
  };

  /** Forget the current pose so a stale one can never be captured or re-published. */
  const clearPose = (): void => {
    lastFrameAtMs = null;
    lastNormalized = null;
    neutralizer.reset();
    calibrator.clearLivePose();
  };

  const publishLive = (normalized: ControlFrame, now: number): void => {
    const mapped = applyAxisMap(normalized, axisMap);
    const calibrated = calibrator.record(mapped);
    const safe = protectControl(control, calibrated);
    const neutralized = neutralizer.process(safe, now);
    publish(
      neutralized.neutralized ? neutralized.control : smoothControl(control, neutralized.control),
    );
  };

  /**
   * Re-run the current pose through map + calibration after the operator changed one of them, so
   * a tuning tweak shows up immediately instead of on the next device frame. Deliberately skips
   * the neutralizer and smoothing: this is a re-interpretation of a known pose, not new input.
   */
  const republishTuned = (): void => {
    if (lastNormalized === null) {
      emitState();
      return;
    }
    const mapped = applyAxisMap(lastNormalized, axisMap);
    const calibrated = applyCalibration(mapped, calibrator.calibration);
    publish(protectControl(createNeutralControl(), calibrated));
    emitState();
  };

  return {
    get control(): ControlFrame {
      return control;
    },
    get state(): BridgeState {
      return readState(Date.now());
    },

    ingest(rawValue: string, now: number = Date.now()): void {
      const frame = parseDeviceFrame(rawValue);
      if (frame === null) {
        // Unreadable traffic on the device socket is treated as a lost controller, not ignored.
        clearPose();
        publish(createNeutralControl());
        return;
      }

      // Register and heartbeat frames carry no orientation — they keep the socket alive but
      // must not be mistaken for a level pose.
      if (!isOrientationFrame(frame)) {
        return;
      }

      lastFrameAtMs = now;
      lastNormalized = normalizeDeviceFrame(frame, now);
      publishLive(lastNormalized, now);
    },

    setDeviceConnected(connected: boolean): void {
      if (deviceConnected === connected) {
        return;
      }
      deviceConnected = connected;
      if (!connected) {
        clearPose();
        publish(createNeutralControl());
      }
      emitState();
    },

    tick(now: number = Date.now()): void {
      if (lastFrameAtMs === null || now - lastFrameAtMs <= STALE_AFTER_MS) {
        return;
      }
      // The device went quiet without closing its socket — drop to neutral rather than holding
      // the last pose, which would leave the glider banked forever.
      clearPose();
      publish(createNeutralControl());
      emitState(now);
    },

    calibrate(now: Date = new Date()): CalibrationResult {
      const result = calibrator.calibrateCurrentPose(now);
      if (result.ok) {
        republishTuned();
      }
      return result;
    },

    resetCalibration(): void {
      calibrator.reset();
      republishTuned();
    },

    setAxisField(field: AxisMapField, enabled: boolean): void {
      if (axisMap[field] === enabled) {
        return;
      }
      axisMap = { ...axisMap, [field]: enabled };
      options.onAxisMapChange?.(axisMap);
      republishTuned();
    },
  };
}

export {
  STALE_AFTER_MS,
  isOrientationFrame,
  normalizeDeviceFrame,
  smoothControl,
} from "./normalize.ts";
export { applyAxisMap, isActiveAxisMap } from "./axis-map.ts";
export { protectControl } from "./safety.ts";
export {
  type Calibration,
  type CalibrationResult,
  NEUTRAL_CALIBRATION,
  applyCalibration,
  createCalibrator,
  readCalibration,
} from "./calibration.ts";
export {
  type AutoNeutralizerResult,
  DEFAULT_AUTO_NEUTRALIZER_CONFIG,
  createAutoNeutralizer,
} from "./auto-neutralize.ts";
