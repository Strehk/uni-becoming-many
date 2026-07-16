// ── Becoming Many — Grass Biome Affinity ───────────────────────
//
// "All biomes fitting for grass" as a dense 0..1 lookup, derived from the old GLB
// grass species' biome affinities in `src/life/species.ts` (grass + grass-short,
// now removed). This is the single source of truth for WHERE the GPU grass grows.
//
// The per-pixel grass mask is deliberately simple: every dry terrain cell grows
// grass. Mountains, snow, rock, desert and low-vegetation cells therefore remain
// covered; only the terrain's semantic water mask cuts the field away.

import { BIOME_COUNT, Biome } from "../terrain/index.ts";

/** Per-biome density, 0..1. Every biome starts enabled; ocean/lake/river cells
 * are rejected by `water`, not by their discrete biome id. */
const AFFINITY: Partial<Record<Biome, number>> = {
  [Biome.Ocean]: 1.0,
  [Biome.Coast]: 1.0,
  [Biome.Beach]: 1.0,
  [Biome.Grassland]: 1.0,
  [Biome.Forest]: 1.0,
  [Biome.Wetland]: 1.0,
  [Biome.Desert]: 1.0,
  [Biome.Hills]: 1.0,
  [Biome.RockyMountain]: 1.0,
  [Biome.SnowMountain]: 1.0,
  [Biome.Lake]: 1.0,
  [Biome.River]: 1.0,
  [Biome.Tundra]: 1.0,
  [Biome.Taiga]: 1.0,
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

/** Grass suitability 0..1 for one field cell. Vegetation and slope are accepted
 * for the shared field contract but intentionally do not suppress dry grass. */
export function grassMask(
  biome: number,
  _vegetation: number,
  _slope: number,
  water: number,
): number {
  if (water !== 0) return 0;
  return GRASS_AFFINITY[biome] ?? 1;
}
