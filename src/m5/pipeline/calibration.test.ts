/**
 * Calibration cases, ported from dweigend/Icaros_Host
 * `src/lib/server/control/calibration.test.ts`. The point they defend: offsets live in public
 * -1..1 units, they clamp, and they can never turn "no signal" into steering.
 */
import { describe, expect, it } from "bun:test";
import { type ControlFrame, createNeutralControl } from "../protocol.ts";
import { applyCalibration, createCalibrator, readCalibration } from "./calibration.ts";

const LIVE_CONTROL: ControlFrame = {
  pitch: 0.35,
  roll: -0.2,
  quality: 1,
  buttonPressed: false,
  buttonDown: false,
  buttonUp: false,
  controllerType: "m5",
};

describe("calibration offsets", () => {
  it("shifts pitch and roll in normalized units", () => {
    const calibrated = applyCalibration(LIVE_CONTROL, {
      pitchOffset: 0.1,
      rollOffset: -0.05,
      calibratedAt: null,
    });

    expect(calibrated.pitch).toBeCloseTo(0.25);
    expect(calibrated.roll).toBeCloseTo(-0.15);
    expect(calibrated.quality).toBe(1);
    expect(calibrated.controllerType).toBe("m5");
  });

  it("clamps the calibrated output into -1..1", () => {
    expect(
      applyCalibration(
        { ...LIVE_CONTROL, pitch: 0.8, roll: -0.8 },
        { pitchOffset: -0.8, rollOffset: 0.8, calibratedAt: null },
      ),
    ).toEqual({
      pitch: 1,
      roll: -1,
      quality: 1,
      buttonPressed: false,
      buttonDown: false,
      buttonUp: false,
      controllerType: "m5",
    });
  });

  it("keeps a neutral control neutral even with offsets set", () => {
    expect(
      applyCalibration(createNeutralControl(), {
        pitchOffset: 0.35,
        rollOffset: -0.2,
        calibratedAt: "2026-06-24T12:00:00.000Z",
      }),
    ).toEqual(createNeutralControl());
  });
});

describe("calibrator", () => {
  it("adopts the current live pose as neutral", () => {
    const calibrator = createCalibrator();
    calibrator.record(LIVE_CONTROL);

    const result = calibrator.calibrateCurrentPose(new Date("2026-06-24T12:00:00Z"));

    expect(result).toEqual({
      ok: true,
      calibration: {
        pitchOffset: 0.35,
        rollOffset: -0.2,
        calibratedAt: "2026-06-24T12:00:00.000Z",
      },
    });
    expect(calibrator.record(LIVE_CONTROL)).toEqual({
      pitch: 0,
      roll: 0,
      quality: 1,
      buttonPressed: false,
      buttonDown: false,
      buttonUp: false,
      controllerType: "m5",
    });
  });

  it("refuses to calibrate without a live pose", () => {
    const calibrator = createCalibrator();
    expect(calibrator.calibrateCurrentPose().ok).toBe(false);

    // A signal-less control is not a pose: it must not become the new zero.
    calibrator.record(createNeutralControl());
    expect(calibrator.hasLivePose).toBe(false);
    expect(calibrator.calibrateCurrentPose().ok).toBe(false);
  });

  it("forgets the live pose when the device goes quiet", () => {
    const calibrator = createCalibrator();
    calibrator.record(LIVE_CONTROL);
    calibrator.clearLivePose();

    expect(calibrator.hasLivePose).toBe(false);
    expect(calibrator.calibrateCurrentPose().ok).toBe(false);
  });

  it("reset restores uncalibrated controls", () => {
    const calibrator = createCalibrator({
      calibration: {
        pitchOffset: 0.35,
        rollOffset: -0.2,
        calibratedAt: "2026-06-24T12:00:00.000Z",
      },
    });

    calibrator.reset();

    expect(calibrator.record(LIVE_CONTROL)).toEqual(LIVE_CONTROL);
    expect(calibrator.isActive).toBe(false);
  });

  it("reports changes so the caller can persist them", () => {
    const seen: string[] = [];
    const calibrator = createCalibrator({
      onChange: (calibration) => seen.push(String(calibration.pitchOffset)),
    });

    calibrator.record(LIVE_CONTROL);
    calibrator.calibrateCurrentPose();
    calibrator.reset();

    expect(seen).toEqual(["0.35", "0"]);
  });
});

describe("persisted calibration", () => {
  it("reads back a stored calibration", () => {
    expect(readCalibration({ pitchOffset: 0.4, rollOffset: -0.1, calibratedAt: "x" })).toEqual({
      pitchOffset: 0.4,
      rollOffset: -0.1,
      calibratedAt: "x",
    });
  });

  it("rejects unusable stored values", () => {
    expect(readCalibration(null)).toBeNull();
    expect(readCalibration("nope")).toBeNull();
    expect(readCalibration({ pitchOffset: "0.4", rollOffset: 0 })).toBeNull();
    expect(readCalibration({ pitchOffset: 0.4 })).toBeNull();
  });

  it("clamps stored offsets that are out of range", () => {
    expect(readCalibration({ pitchOffset: 9, rollOffset: -9 })).toEqual({
      pitchOffset: 1,
      rollOffset: -1,
      calibratedAt: null,
    });
  });
});
