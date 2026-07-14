// ── Becoming Many — Grass Biome Affinity ───────────────────────
//
// "All biomes fitting for grass" as a dense 0..1 lookup, derived from the old GLB
// grass species' biome affinities in `src/life/species.ts` (grass + grass-short,
// now removed). This is the single source of truth for WHERE the GPU grass grows.
//
// The per-pixel grass mask a chunk contributes is `affinity[biome] × vegetation ×
// slopeGate × (water ? 0 : 1)` — the same rejection layers `src/life/scatter.ts`
// uses, collapsed into one scalar that the field texture carries to the GPU.

import { BIOME_COUNT, Biome } from "../terrain/index.ts";

/** Steeper than this and grass stops (with a linear taper up to it). */
const MAX_SLOPE = 0.7;

/** Per-biome grass affinity, 0..1. Biomes absent from this map never grow grass. */
const AFFINITY: Partial<Record<Biome, number>> = {
  [Biome.Grassland]: 1.0,
  [Biome.Hills]: 0.6,
  [Biome.Tundra]: 0.4,
  [Biome.Forest]: 0.35,
  [Biome.Taiga]: 0.3,
  [Biome.Beach]: 0.2,
  [Biome.Wetland]: 0.15,
};

/** Dense BASE affinity table indexed by biome id (avoids indexing a numeric-enum
 *  Record with a runtime number, which strict TS rightly rejects). */
const BASE_AFFINITY = ((): Float32Array => {
  const table = new Float32Array(BIOME_COUNT);
  for (const [key, value] of Object.entries(AFFINITY)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < BIOME_COUNT && value !== undefined) {
      table[index] = value;
    }
  }
  return table;
})();

/** The LIVE affinity table `grassMask` reads — base × the flora config's
 *  per-biome grass multipliers (see `setGrassBiomeConfig`). */
export const GRASS_AFFINITY = new Float32Array(BASE_AFFINITY);

/** Apply the flora config's per-biome grass density multipliers (1 = authored,
 *  clamped ≥ 0). The field texture repaints from `grassMask`, so callers should
 *  invalidate it for an instant refresh (see grass/index.ts `applyConfig`). */
export function setGrassBiomeConfig(mul: {
  meadow: number;
  forest: number;
  taiga: number;
  hills: number;
}): void {
  GRASS_AFFINITY.set(BASE_AFFINITY);
  const scale = (biome: Biome, m: number): void => {
    GRASS_AFFINITY[biome] = (BASE_AFFINITY[biome] ?? 0) * Math.max(0, m);
  };
  scale(Biome.Grassland, mul.meadow);
  scale(Biome.Forest, mul.forest);
  scale(Biome.Taiga, mul.taiga);
  scale(Biome.Hills, mul.hills);
}

/** Grass suitability 0..1 for one field cell. `biome`/`vegetation`/`slope`/`water`
 *  are the per-cell values from a chunk's `ChunkFields`. */
export function grassMask(biome: number, vegetation: number, slope: number, water: number): number {
  if (water !== 0) return 0;
  const affinity = GRASS_AFFINITY[biome] ?? 0;
  if (affinity <= 0) return 0;
  if (slope >= MAX_SLOPE) return 0;
  const slopeGate = 1 - slope / MAX_SLOPE;
  return affinity * vegetation * slopeGate;
}
