// ── Becoming Many — Config → GenParams Bridge ──────────────────
//
// Bridges the flat TerrainConfig (seed/amplitude/frequency/octaves — the Settings
// sliders) onto the rich GenParams (~50 knobs). The four flat knobs map onto the
// most visually-impactful params; everything else stays at flight-retuned
// defaults. Lives worker-side only (PURE CPU — no three, no DOM).

import type { TerrainConfig } from "../provider.ts";
import { DEFAULT_PARAMS, type GenParams } from "./mapTypes.ts";

// Retuned for flight (source default is 340). At 100 the worst-case peak is
// ~566 m — under the 620 m far plane — while typical land sits near cruise height.
const BASE_HEIGHT_SCALE = 100;

// Continents shrunk from the source's 2200 so hills/valleys/mountains read within
// a normal flight. The Terrain Frequency slider divides this live.
const BASE_CONTINENT_SCALE = 700;

/** GenParams with the flight-retuned vertical + continent scale. */
export const WORLDGEN_PARAMS: GenParams = {
  ...DEFAULT_PARAMS,
  terrainHeightScale: BASE_HEIGHT_SCALE,
  continentScale: BASE_CONTINENT_SCALE,
  // Elevation defaults dialed in for flight (softer contrast, gentler relief
  // curve, lower mountains) — the rest stay at the source DEFAULT_PARAMS.
  heightScale: 0.8,
  mountainStrength: 0.8,
  reliefExponent: 1.5,
};

/** Fold a flat TerrainConfig onto the full GenParams. */
export function configToParams(cfg: TerrainConfig): GenParams {
  return {
    ...WORLDGEN_PARAMS,
    seed: cfg.seed >>> 0,
    // amplitude scales the single world-height knob.
    terrainHeightScale: BASE_HEIGHT_SCALE * cfg.amplitude,
    // frequency widens (>1) / narrows (<1) the continents.
    continentScale: WORLDGEN_PARAMS.continentScale / Math.max(0.1, cfg.frequency),
  };
}
