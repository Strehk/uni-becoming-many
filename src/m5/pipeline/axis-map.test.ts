/**
 * Axis-map cases, ported from dweigend/Icaros_Host
 * `src/lib/server/control/orientation-map.test.ts`. They pin the one subtlety: inversion applies
 * to the axes *after* the swap, so the flags always describe the output.
 */
import { describe, expect, it } from "bun:test";
import { type ControlFrame, createNeutralControl, isAxisMapField } from "../protocol.ts";
import { applyAxisMap, isActiveAxisMap } from "./axis-map.ts";

const LIVE_CONTROL: ControlFrame = {
  pitch: 0.35,
  roll: -0.2,
  quality: 1,
  buttonPressed: false,
  buttonDown: false,
  buttonUp: false,
  controllerType: "m5",
};

describe("axis map", () => {
  it("is an identity transform with all flags off", () => {
    expect(
      applyAxisMap(LIVE_CONTROL, {
        swapPitchRoll: false,
        invertPitch: false,
        invertRoll: false,
      }),
    ).toEqual(LIVE_CONTROL);
  });

  it("exchanges pitch and roll when swap is on", () => {
    const mapped = applyAxisMap(LIVE_CONTROL, {
      swapPitchRoll: true,
      invertPitch: false,
      invertRoll: false,
    });

    expect(mapped.pitch).toBeCloseTo(-0.2);
    expect(mapped.roll).toBeCloseTo(0.35);
  });

  it("negates each output axis independently", () => {
    const mapped = applyAxisMap(LIVE_CONTROL, {
      swapPitchRoll: false,
      invertPitch: true,
      invertRoll: true,
    });

    expect(mapped.pitch).toBeCloseTo(-0.35);
    expect(mapped.roll).toBeCloseTo(0.2);
  });

  it("negates the post-swap axes", () => {
    // swap -> pitch=-0.2, roll=0.35 ; then invert pitch -> pitch=0.2
    const mapped = applyAxisMap(LIVE_CONTROL, {
      swapPitchRoll: true,
      invertPitch: true,
      invertRoll: false,
    });

    expect(mapped.pitch).toBeCloseTo(0.2);
    expect(mapped.roll).toBeCloseTo(0.35);
  });

  it("preserves quality, buttons and controller type", () => {
    const mapped = applyAxisMap(
      { ...LIVE_CONTROL, buttonDown: true },
      { swapPitchRoll: true, invertPitch: true, invertRoll: true },
    );

    expect(mapped.quality).toBe(1);
    expect(mapped.buttonDown).toBe(true);
    expect(mapped.controllerType).toBe("m5");
  });

  it("keeps a neutral control neutral regardless of flags", () => {
    const mapped = applyAxisMap(createNeutralControl(), {
      swapPitchRoll: true,
      invertPitch: true,
      invertRoll: true,
    });

    expect(mapped.pitch).toBeCloseTo(0);
    expect(mapped.roll).toBeCloseTo(0);
    expect(mapped.quality).toBe(0);
  });

  it("reports whether it does anything", () => {
    expect(isActiveAxisMap({ swapPitchRoll: false, invertPitch: false, invertRoll: false })).toBe(
      false,
    );
    expect(isActiveAxisMap({ swapPitchRoll: false, invertPitch: true, invertRoll: false })).toBe(
      true,
    );
  });

  it("recognizes only the three known map fields", () => {
    expect(isAxisMapField("swapPitchRoll")).toBe(true);
    expect(isAxisMapField("invertPitch")).toBe(true);
    expect(isAxisMapField("invertRoll")).toBe(true);
    expect(isAxisMapField("pitch")).toBe(false);
    expect(isAxisMapField(null)).toBe(false);
  });
});
