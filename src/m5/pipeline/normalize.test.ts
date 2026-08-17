/**
 * Normalization and safety cases, ported from dweigend/Icaros_Host
 * `src/lib/server/control/normalizer.test.ts`. They pin the numbers the flight feel depends on:
 * 22.5° is exactly half of the ±45° working range, and the 0.25 smoothing factor turns an 18°
 * (0.4) step into 0.1 on the first frame.
 */
import { describe, expect, it } from "bun:test";
import { createNeutralControl } from "../protocol.ts";
import { normalizeDeviceFrame, smoothControl } from "./normalize.ts";
import { protectControl } from "./safety.ts";

describe("normalization", () => {
  it("maps degrees onto the public -1..1 control shape", () => {
    expect(normalizeDeviceFrame({ pitch: 22.5, roll: -11.25, quality: 0.8 })).toEqual({
      pitch: 0.5,
      roll: -0.25,
      quality: 0.8,
      buttonPressed: false,
      buttonDown: false,
      buttonUp: false,
      controllerType: "m5",
    });
  });

  it("passes button state and edge flags through", () => {
    expect(
      normalizeDeviceFrame({
        pitch: 0,
        roll: 0,
        buttonPressed: true,
        buttonDown: true,
        buttonUp: false,
      }),
    ).toEqual({
      pitch: 0,
      roll: 0,
      quality: 1,
      buttonPressed: true,
      buttonDown: true,
      buttonUp: false,
      controllerType: "m5",
    });
  });

  it("clamps beyond the working range instead of overshooting", () => {
    const control = normalizeDeviceFrame({ pitch: 90, roll: -90 });
    expect(control.pitch).toBe(1);
    expect(control.roll).toBe(-1);
  });

  it("accepts the legacy axis aliases of older firmware", () => {
    expect(normalizeDeviceFrame({ angleY: 22.5, angleX: -22.5 })).toMatchObject({
      pitch: 0.5,
      roll: -0.5,
    });
    expect(normalizeDeviceFrame({ rotationY: 22.5, rotationX: -22.5 })).toMatchObject({
      pitch: 0.5,
      roll: -0.5,
    });
  });

  it("returns neutral for missing or stale orientation", () => {
    expect(normalizeDeviceFrame({ type: "heartbeat" })).toEqual(createNeutralControl());
    expect(normalizeDeviceFrame({ pitch: 10, roll: 10, timestamp: 1_000 }, 2_500)).toEqual(
      createNeutralControl(),
    );
  });

  it("ignores non-numeric axis values rather than trusting them", () => {
    expect(normalizeDeviceFrame({ pitch: "22.5", roll: 0 })).toEqual(createNeutralControl());
    expect(normalizeDeviceFrame({ pitch: Number.NaN, roll: 0 })).toEqual(createNeutralControl());
  });
});

describe("smoothing", () => {
  it("eases up from neutral instead of jumping to the live pose", () => {
    expect(
      smoothControl(createNeutralControl(), normalizeDeviceFrame({ pitch: 18, roll: 0 })),
    ).toEqual({
      pitch: 0.1,
      roll: 0,
      quality: 1,
      buttonPressed: false,
      buttonDown: false,
      buttonUp: false,
      controllerType: "m5",
    });
  });

  it("lets a neutral control land immediately", () => {
    const live = normalizeDeviceFrame({ pitch: 45, roll: 45 });
    expect(smoothControl(live, createNeutralControl())).toEqual(createNeutralControl());
  });
});

describe("safety", () => {
  it("keeps a controller that reconnects at an extreme angle neutral", () => {
    const next = normalizeDeviceFrame({ pitch: 45, roll: 0, quality: 1 });
    expect(protectControl(createNeutralControl(), next)).toEqual(createNeutralControl());
  });

  it("flattens an abrupt outlier step but keeps the button edge", () => {
    const previous = normalizeDeviceFrame({ pitch: 0, roll: 0, quality: 1 });
    const next = normalizeDeviceFrame({ pitch: 45, roll: 0, quality: 1, buttonDown: true });

    expect(protectControl(previous, next)).toEqual({
      ...createNeutralControl(),
      buttonDown: true,
    });
  });

  it("lets a plausible movement through untouched", () => {
    const previous = normalizeDeviceFrame({ pitch: 0, roll: 0, quality: 1 });
    const next = normalizeDeviceFrame({ pitch: 9, roll: -9, quality: 1 });
    expect(protectControl(previous, next)).toEqual(next);
  });
});
