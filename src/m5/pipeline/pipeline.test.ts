/**
 * Composition tests for the assembled pipeline. The individual stages are covered next to their
 * own modules; what is pinned here is the wiring the host only had implicitly inside its
 * gateway — stage order, what does and does not publish, and the paths back to neutral.
 */
import { describe, expect, it } from "bun:test";
import type { ControlFrame } from "../protocol.ts";
import { type ControlPipeline, createControlPipeline } from "./index.ts";

/** A pipeline plus the controls it published, in order. */
function createHarness(): { pipeline: ControlPipeline; published: ControlFrame[] } {
  const published: ControlFrame[] = [];
  const pipeline = createControlPipeline({ onControl: (control) => published.push(control) });
  return { pipeline, published };
}

function lastOf(published: readonly ControlFrame[]): ControlFrame {
  const control = published.at(-1);
  if (control === undefined) {
    throw new Error("Expected at least one published control");
  }
  return control;
}

/** 22.5° is half of the ±45° working range, so this frame is exactly 0.5 before smoothing. */
const HALF_PITCH_FRAME = JSON.stringify({ type: "orientation", pitch: 22.5, roll: 0 });

describe("pipeline ingest", () => {
  it("eases the first live frame up from neutral", () => {
    const { pipeline, published } = createHarness();

    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    // 0.5 normalized, then the 0.25 smoothing factor on the way out of neutral.
    expect(lastOf(published).pitch).toBeCloseTo(0.125);
    expect(lastOf(published).quality).toBe(1);
  });

  it("converges on the live pose across successive frames", () => {
    const { pipeline, published } = createHarness();

    for (let i = 1; i <= 20; i += 1) {
      pipeline.ingest(HALF_PITCH_FRAME, 1_000 + i * 50);
    }

    expect(lastOf(published).pitch).toBeCloseTo(0.5, 2);
  });

  it("publishes nothing for frames that carry no orientation", () => {
    const { pipeline, published } = createHarness();

    pipeline.ingest(JSON.stringify({ type: "heartbeat", quality: 1 }), 1_000);
    pipeline.ingest(JSON.stringify({ type: "register", firmwareVersion: "0.2.2" }), 1_010);

    expect(published).toHaveLength(0);
  });

  it("treats unreadable traffic as a lost controller", () => {
    const { pipeline, published } = createHarness();

    pipeline.ingest(HALF_PITCH_FRAME, 1_000);
    pipeline.ingest("<not json>", 1_050);

    expect(lastOf(published).quality).toBe(0);
    expect(lastOf(published).pitch).toBe(0);
  });
});

describe("pipeline paths back to neutral", () => {
  it("drops to neutral once the device stops sending", () => {
    const { pipeline, published } = createHarness();
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    pipeline.tick(2_000); // exactly at the stale threshold — still live
    expect(lastOf(published).quality).toBe(1);

    pipeline.tick(2_001);
    expect(lastOf(published).quality).toBe(0);
  });

  it("stops ticking to neutral once the pose is already cleared", () => {
    const { pipeline, published } = createHarness();
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);
    pipeline.tick(2_001);
    const afterFirstTick = published.length;

    pipeline.tick(3_000);
    pipeline.tick(4_000);

    expect(published).toHaveLength(afterFirstTick);
  });

  it("neutralizes when the device socket closes", () => {
    const { pipeline, published } = createHarness();
    pipeline.setDeviceConnected(true);
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    pipeline.setDeviceConnected(false);

    expect(lastOf(published).quality).toBe(0);
  });
});

describe("pipeline tuning", () => {
  it("re-publishes the current pose when an axis flag flips", () => {
    const { pipeline, published } = createHarness();
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    pipeline.setAxisField("invertPitch", true);

    // Re-interpreting a known pose skips smoothing, so the full inverted value lands at once.
    expect(lastOf(published).pitch).toBeCloseTo(-0.5);
  });

  it("ignores a flag that is already set", () => {
    const { pipeline, published } = createHarness();
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);
    const before = published.length;

    pipeline.setAxisField("invertPitch", false);

    expect(published).toHaveLength(before);
  });

  it("makes the current pose the new zero", () => {
    const { pipeline, published } = createHarness();
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    const result = pipeline.calibrate(new Date("2026-06-24T12:00:00Z"));

    expect(result.ok).toBe(true);
    expect(lastOf(published).pitch).toBeCloseTo(0);

    // …and the same physical pose keeps reading zero afterwards.
    pipeline.ingest(HALF_PITCH_FRAME, 1_050);
    expect(lastOf(published).pitch).toBeCloseTo(0);
  });

  it("calibrates against the mapped pose, so a later axis flip does not need re-calibration", () => {
    const { pipeline, published } = createHarness();
    pipeline.setAxisField("invertPitch", true);
    pipeline.ingest(HALF_PITCH_FRAME, 1_000);

    pipeline.calibrate();

    expect(lastOf(published).pitch).toBeCloseTo(0);
  });

  it("refuses to calibrate with no live signal", () => {
    const { pipeline } = createHarness();
    expect(pipeline.calibrate().ok).toBe(false);
  });

  it("reports calibration and axis changes for persistence", () => {
    const calibrations: number[] = [];
    const axisMaps: boolean[] = [];
    const pipeline = createControlPipeline({
      onControl: () => {},
      onCalibrationChange: (calibration) => calibrations.push(calibration.pitchOffset),
      onAxisMapChange: (axisMap) => axisMaps.push(axisMap.invertRoll),
    });

    pipeline.ingest(HALF_PITCH_FRAME, 1_000);
    pipeline.calibrate();
    pipeline.setAxisField("invertRoll", true);

    expect(calibrations).toEqual([0.5]);
    expect(axisMaps).toEqual([true]);
  });
});

describe("pipeline state", () => {
  it("tracks device presence and frame age", () => {
    const { pipeline } = createHarness();
    expect(pipeline.state.deviceConnected).toBe(false);
    expect(pipeline.state.lastFrameAgoMs).toBeNull();

    pipeline.setDeviceConnected(true);
    pipeline.ingest(HALF_PITCH_FRAME, Date.now());

    expect(pipeline.state.deviceConnected).toBe(true);
    expect(pipeline.state.lastFrameAgoMs).not.toBeNull();
  });
});
