// ── Becoming Many — Performance tuning persistence (Theatre-style state.json) ──
//
// The performance knobs authored in the C dev console (Performance panel) that
// have no other home: render scale, the grass draw window, and the terrain
// stream radius. Flora/fauna counts and the duft/motion budgets the panel also
// drives persist through THEIR owners' state.json files (flora-fauna / senses)
// via the existing save buttons — this file deliberately stays tiny.
//
// The dev-only export button lives in the dev console (dev-console/save-tuning.ts);
// this module owns the file, the load/apply, and the serialize.

import savedPerfState from "./state.json";

export { savedPerfState };

export interface PerfState {
  version: 1;
  /** Last chosen preset id ("niedrig" | "mittel" | "hoch" | "ultra" | "eigene"). */
  preset: string;
  /** Pixel-ratio cap: effective ratio = min(devicePixelRatio, renderScale). */
  renderScale: number;
  /** Desktop grass draw radius, metres (VR keeps its own profile). */
  grassRadius: number;
  /** Fraction of grass blades kept in the broad field (0..1). */
  grassKeepFraction: number;
  /** Terrain chunk build radius in cells (keep = build + 1). */
  streamBuildRadius: number;
  /** Flora view distance, metres — chunks beyond it carry no instances (≥896 = off). */
  floraViewDistance: number;
}

/** Committed defaults. renderScale 1 (not the full devicePixelRatio): on Retina
 *  a scale-2 buffer is 4× the fragments — measured 16 ms → 9 ms GPU frame at
 *  scale 1 with five senses active. Ultra re-opens the full ratio deliberately. */
export const DEFAULT_PERF_STATE: PerfState = {
  version: 1,
  preset: "eigene",
  renderScale: 1,
  grassRadius: 48,
  grassKeepFraction: 1,
  streamBuildRadius: 2,
  floraViewDistance: 520,
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Narrow a committed state.json (tolerant: falls back field-wise to defaults). */
export function perfStateFrom(source: unknown): PerfState {
  const d = DEFAULT_PERF_STATE;
  if (typeof source !== "object" || source === null) {
    return { ...d };
  }
  const s = source as Partial<Record<keyof PerfState, unknown>>;
  return {
    version: 1,
    preset: typeof s.preset === "string" ? s.preset : d.preset,
    renderScale: num(s.renderScale, d.renderScale),
    grassRadius: num(s.grassRadius, d.grassRadius),
    grassKeepFraction: num(s.grassKeepFraction, d.grassKeepFraction),
    streamBuildRadius: num(s.streamBuildRadius, d.streamBuildRadius),
    floraViewDistance: num(s.floraViewDistance, d.floraViewDistance),
  };
}

/** The apply surface the perf state drives (structural — no module imports). */
export interface PerfTargets {
  setRenderScale(scale: number): void;
  setGrassPerformance(perf: { renderRadius?: number; keepFraction?: number }): void;
  setStreamingRadii(buildRadius: number): void;
  setFloraViewDistance(metres: number): void;
}

/** Push a perf state onto the live world (boot restore + preset application). */
export function applyPerfState(state: PerfState, targets: PerfTargets): void {
  targets.setRenderScale(state.renderScale);
  targets.setGrassPerformance({
    renderRadius: state.grassRadius,
    keepFraction: state.grassKeepFraction,
  });
  targets.setStreamingRadii(state.streamBuildRadius);
  targets.setFloraViewDistance(state.floraViewDistance);
}

/** Snapshot the live perf tuning for the dev export (⤓ Performance button). */
export function serializePerfState(state: PerfState): PerfState {
  return { ...state };
}
