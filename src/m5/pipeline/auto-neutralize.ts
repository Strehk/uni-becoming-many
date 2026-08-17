/**
 * Rest-pose neutralizer.
 *
 * The Icaros rig does not sit level when nobody is flying it — it rests mechanically tilted, so
 * the raw control reads a constant lean that would slowly fly the glider into the ground while
 * the station is idle. When the control sits inside a small window around that known rest pose
 * for five uninterrupted seconds, pitch and roll are forced to zero until it moves out again.
 *
 * This is *not* a replacement for calibration: calibration shifts the whole stream, this only
 * silences a station standing still. Quality and button state are left untouched.
 *
 * Ported verbatim (logic and constants) from dweigend/Icaros_Host
 * `src/lib/server/control/auto-neutralizer.ts`.
 */
import type { ControlFrame } from "../protocol.ts";

export type AutoNeutralizerConfig = Readonly<{
  /** Pitch the unloaded rig rests at, in -1..1 units. */
  restPitch: number;
  /** Roll the unloaded rig rests at. The mount leans hard to one side. */
  restRoll: number;
  stableDurationMs: number;
  tolerance: number;
  /** A gap larger than this means frames were lost, so the stability window restarts. */
  maxFrameGapMs: number;
}>;

export type AutoNeutralizerStatus = "idle" | "stabilizing" | "neutralized";

export type AutoNeutralizerResult = Readonly<{
  control: ControlFrame;
  neutralized: boolean;
  status: AutoNeutralizerStatus;
}>;

export interface AutoNeutralizer {
  process(control: ControlFrame, now: number): AutoNeutralizerResult;
  reset(): void;
  readonly status: AutoNeutralizerStatus;
}

export const DEFAULT_AUTO_NEUTRALIZER_CONFIG: AutoNeutralizerConfig = {
  restPitch: 0.02,
  restRoll: -0.8,
  stableDurationMs: 5_000,
  tolerance: 0.08,
  maxFrameGapMs: 1_000,
};

export function createAutoNeutralizer(
  config: AutoNeutralizerConfig = DEFAULT_AUTO_NEUTRALIZER_CONFIG,
): AutoNeutralizer {
  let stableSinceMs: number | null = null;
  let lastFrameAtMs: number | null = null;
  let status: AutoNeutralizerStatus = "idle";

  const resetWindow = (): void => {
    stableSinceMs = null;
    status = "idle";
  };

  const reset = (): void => {
    lastFrameAtMs = null;
    resetWindow();
  };

  const result = (control: ControlFrame): AutoNeutralizerResult => ({
    control,
    neutralized: status === "neutralized",
    status,
  });

  return {
    process(control: ControlFrame, now: number): AutoNeutralizerResult {
      if (control.quality <= 0 || !Number.isFinite(now)) {
        reset();
        return result(control);
      }

      if (lastFrameAtMs !== null && !hasPlausibleFrameTiming(lastFrameAtMs, now, config)) {
        resetWindow();
      }
      lastFrameAtMs = now;

      if (!isNearRestPose(control, config)) {
        resetWindow();
        return result(control);
      }

      if (stableSinceMs === null) {
        stableSinceMs = now;
        status = "stabilizing";
        return result(control);
      }

      if (now - stableSinceMs < config.stableDurationMs) {
        status = "stabilizing";
        return result(control);
      }

      status = "neutralized";
      return result({ ...control, pitch: 0, roll: 0 });
    },
    reset,
    get status(): AutoNeutralizerStatus {
      return status;
    },
  };
}

function hasPlausibleFrameTiming(
  previousMs: number,
  nowMs: number,
  config: AutoNeutralizerConfig,
): boolean {
  const gapMs = nowMs - previousMs;
  return gapMs >= 0 && gapMs <= config.maxFrameGapMs;
}

function isNearRestPose(control: ControlFrame, config: AutoNeutralizerConfig): boolean {
  return (
    Math.abs(control.pitch - config.restPitch) <= config.tolerance &&
    Math.abs(control.roll - config.restRoll) <= config.tolerance
  );
}
