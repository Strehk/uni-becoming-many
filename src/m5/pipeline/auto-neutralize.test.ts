/**
 * Sequence tests for the rest-pose neutralizer, ported from dweigend/Icaros_Host
 * `src/lib/server/control/auto-neutralizer.test.ts`. They pin the timing rules: five
 * uninterrupted seconds inside the tolerance window, restarted by any excursion, any quality
 * drop, or any gap in the frame stream.
 */
import { describe, expect, it } from "bun:test";
import type { ControlFrame } from "../protocol.ts";
import {
  type AutoNeutralizer,
  type AutoNeutralizerResult,
  DEFAULT_AUTO_NEUTRALIZER_CONFIG,
  createAutoNeutralizer,
} from "./auto-neutralize.ts";

const REST_CONTROL: ControlFrame = {
  pitch: DEFAULT_AUTO_NEUTRALIZER_CONFIG.restPitch,
  roll: DEFAULT_AUTO_NEUTRALIZER_CONFIG.restRoll,
  quality: 0.8,
  buttonPressed: false,
  buttonDown: false,
  buttonUp: false,
  controllerType: "m5",
};

describe("auto-neutralizer", () => {
  it("leaves a stable rest pose alone until the five second window completes", () => {
    const neutralizer = createAutoNeutralizer();

    expect(processRestFrames(neutralizer, [0, 1_000, 2_000, 3_000, 4_000, 4_999])).toEqual({
      control: REST_CONTROL,
      neutralized: false,
      status: "stabilizing",
    });
  });

  it("zeroes pitch and roll after five stable seconds while preserving quality", () => {
    const neutralizer = createAutoNeutralizer();

    expect(processRestFrames(neutralizer, [0, 1_000, 2_000, 3_000, 4_000, 5_000])).toEqual({
      control: { ...REST_CONTROL, pitch: 0, roll: 0 },
      neutralized: true,
      status: "neutralized",
    });
  });

  it("releases as soon as the pose leaves the tolerance window", () => {
    const neutralizer = createAutoNeutralizer();
    const movedControl: ControlFrame = {
      ...REST_CONTROL,
      roll: REST_CONTROL.roll + DEFAULT_AUTO_NEUTRALIZER_CONFIG.tolerance + 0.01,
    };

    processRestFrames(neutralizer, [0, 1_000, 2_000, 3_000, 4_000, 5_000]);

    expect(neutralizer.process(movedControl, 5_100)).toEqual({
      control: movedControl,
      neutralized: false,
      status: "idle",
    });
    expect(
      processRestFrames(neutralizer, [5_200, 6_200, 7_200, 8_200, 9_200, 10_200]).neutralized,
    ).toBe(true);
  });

  it("restarts the window when the signal drops out", () => {
    const neutralizer = createAutoNeutralizer();
    const neutralQualityControl: ControlFrame = { ...REST_CONTROL, quality: 0 };

    processRestFrames(neutralizer, [0, 1_000, 2_000, 3_000, 4_000, 5_000]);

    expect(neutralizer.process(neutralQualityControl, 5_100)).toEqual({
      control: neutralQualityControl,
      neutralized: false,
      status: "idle",
    });
    expect(
      processRestFrames(neutralizer, [5_200, 6_200, 7_200, 8_200, 9_200, 10_199]).neutralized,
    ).toBe(false);
    expect(neutralizer.process(REST_CONTROL, 10_200).neutralized).toBe(true);
  });

  it("requires an uninterrupted frame stream across the window", () => {
    const neutralizer = createAutoNeutralizer();
    const gapResetAt = 900 + DEFAULT_AUTO_NEUTRALIZER_CONFIG.maxFrameGapMs + 1;

    neutralizer.process(REST_CONTROL, 0);
    neutralizer.process(REST_CONTROL, 900);
    neutralizer.process(REST_CONTROL, gapResetAt);

    expect(
      processRestFrames(neutralizer, [
        gapResetAt + 1_000,
        gapResetAt + 2_000,
        gapResetAt + 3_000,
        gapResetAt + 4_000,
        gapResetAt + 4_999,
      ]).neutralized,
    ).toBe(false);
    expect(neutralizer.process(REST_CONTROL, gapResetAt + 5_000).neutralized).toBe(true);
  });

  it("never neutralizes a pose that is not the rest pose", () => {
    const neutralizer = createAutoNeutralizer();
    const flying: ControlFrame = { ...REST_CONTROL, pitch: 0.3, roll: 0.2 };

    for (const at of [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000]) {
      expect(neutralizer.process(flying, at).neutralized).toBe(false);
    }
  });
});

function processRestFrames(
  neutralizer: AutoNeutralizer,
  timestamps: readonly number[],
): AutoNeutralizerResult {
  let result: AutoNeutralizerResult | null = null;
  for (const timestamp of timestamps) {
    result = neutralizer.process(REST_CONTROL, timestamp);
  }
  if (result === null) {
    throw new Error("Expected at least one timestamp");
  }
  return result;
}
