// ── Becoming Many — Config → GenParams Bridge ──────────────────
//
// Bridges the flat TerrainConfig (seed/amplitude/frequency/octaves — the Settings
// sliders) onto the rich GenParams (~50 knobs). The four flat knobs map onto the
// most visually-impactful params; everything else stays at flight-retuned
// defaults. Lives worker-side only (PURE CPU — no three, no DOM).

import type { TerrainConfig } from "../provider.ts";
import { DEFAULT_PARAMS, type GenParams } from "./mapTypes.ts";

// Retuned for flight (source default is 340). Lowered from 100 → 70 so mountains
// read shorter and less dramatic; worst-case peak now sits well under the far plane
// while typical land stays near cruise height.
const BASE_HEIGHT_SCALE = 70;

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
  // Less macro mountain mass (0.8 → 0.5) and a gentler relief power (1.5 → 1.25)
  // so peaks stop towering; softened ridged crests (default 1.0 → 0.6) remove the
  // sharp, unnatural spikes on the mountain flanks.
  mountainStrength: 0.5,
  reliefExponent: 1.25,
  mountainRidgeStrength: 0.6,
  // Lower sea level (source 0.42) so oceans cover far less of the world — more
  // land sits above the waterline.
  waterLevel: 0.33,
  // Wider moisture period (source 900) so forest/desert/wetland regions are
  // larger; pairs with the widened temperature bands in fields.ts.
  moistureScale: 1800,
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
