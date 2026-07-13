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

/** Dense affinity table indexed by biome id (avoids indexing a numeric-enum Record
 *  with a runtime number, which strict TS rightly rejects). */
export const GRASS_AFFINITY = ((): Float32Array => {
  const table = new Float32Array(BIOME_COUNT);
  for (const [key, value] of Object.entries(AFFINITY)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < BIOME_COUNT && value !== undefined) {
      table[index] = value;
    }
  }
  return table;
})();

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
