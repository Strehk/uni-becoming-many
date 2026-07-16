// ── Becoming Many — WFC Adjacency Rules + Priors (Pass A) ───────
//
// Adjacency is a symmetric compatibility relation between macro tiles (an
// edge-agnostic socket model). It encodes: ocean only touches coast/ocean; coast
// bridges ocean and land; desert never touches wetland; snow only near high/cold
// mountain neighbours; rivers connect high→low.
//
// Priors bias each cell toward the tile whose bands best fit the continuous
// (height, temperature, moisture), so the plan follows terrain.
//
// PURE CPU — no three, no DOM.

import { type GenParams, MACRO_TILE_COUNT, MacroTile } from "../mapTypes.ts";
import { bandScore } from "./WfcTile.ts";
import { TILE_BY_ID } from "./biomeTiles.ts";

const M = MacroTile;

// Allowed neighbours per tile (symmetrised below). A tile is always
// self-compatible. Permissive among height-adjacent / climate-sibling families so
// the deterministic argmax borders are legal; the meaningful bans are kept.
const ALLOW: Record<number, MacroTile[]> = {
  // Ocean must NOT touch LakeCandidate — a lake basin abutting the sea produced
  // sea-level "ocean" puddles inside an elevated lake.
  [M.Ocean]: [M.Ocean, M.Coast, M.Lowland, M.Wetland],
  [M.Coast]: [
    M.Ocean,
    M.Coast,
    M.Lowland,
    M.Wetland,
    M.Grassland,
    M.Forest,
    M.Desert,
    M.RiverCorridor,
  ],
  [M.Lowland]: [
    M.Ocean,
    M.Coast,
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Wetland,
    M.Desert,
    M.Hills,
    M.LakeCandidate,
    M.RiverCorridor,
    M.RiverSource,
  ],
  [M.Grassland]: [
    M.Coast,
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Hills,
    M.Desert,
    M.Wetland,
    M.RiverCorridor,
  ],
  [M.Forest]: [
    M.Coast,
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Hills,
    M.Wetland,
    M.RockyMountain,
    M.LakeCandidate,
    M.RiverCorridor,
    M.RiverSource,
  ],
  [M.Wetland]: [
    M.Ocean,
    M.Coast,
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Wetland,
    M.LakeCandidate,
    M.RiverCorridor,
  ],
  [M.Desert]: [M.Coast, M.Lowland, M.Grassland, M.Desert, M.Hills, M.RiverCorridor],
  [M.Hills]: [
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Desert,
    M.Hills,
    M.RockyMountain,
    M.SnowMountain,
    M.RiverSource,
    M.RiverCorridor,
  ],
  [M.RockyMountain]: [
    M.Forest,
    M.Hills,
    M.RockyMountain,
    M.SnowMountain,
    M.RiverSource,
    M.RiverCorridor,
  ],
  [M.SnowMountain]: [M.Hills, M.RockyMountain, M.SnowMountain, M.RiverSource],
  [M.LakeCandidate]: [
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Wetland,
    M.LakeCandidate,
    M.RiverCorridor,
  ],
  [M.RiverSource]: [
    M.Lowland,
    M.Forest,
    M.Hills,
    M.RockyMountain,
    M.SnowMountain,
    M.RiverCorridor,
    M.RiverSource,
  ],
  [M.RiverCorridor]: [
    M.Coast,
    M.Lowland,
    M.Grassland,
    M.Forest,
    M.Wetland,
    M.Desert,
    M.Hills,
    M.RockyMountain,
    M.LakeCandidate,
    M.RiverSource,
    M.RiverCorridor,
  ],
};

/** compatMask[t] = bitmask of tiles compatible as a neighbour of t. */
export const COMPAT_MASK: number[] = (() => {
  const mask = new Array<number>(MACRO_TILE_COUNT).fill(0);
  const set = (a: MacroTile, b: MacroTile): void => {
    mask[a] = (mask[a] ?? 0) | (1 << b);
    mask[b] = (mask[b] ?? 0) | (1 << a);
  };
  for (let t = 0; t < MACRO_TILE_COUNT; t++) {
    set(t, t); // self-compatible
    for (const n of ALLOW[t] ?? []) set(t, n);
  }
  return mask;
})();

export function compatible(a: MacroTile, b: MacroTile): boolean {
  return ((COMPAT_MASK[a] ?? 0) & (1 << b)) !== 0;
}

/** Full-domain bitmask (all tiles allowed). */
export const FULL_DOMAIN = (1 << MACRO_TILE_COUNT) - 1;

/**
 * Per-cell prior weights over all tiles from the continuous fields. Product of
 * the three band scores times the tile's base weight; a tiny floor keeps the
 * domain from ever being fully empty.
 */
export function tilePriors(
  height: number,
  temp: number,
  moisture: number,
  params: GenParams,
): Float32Array {
  const w = new Float32Array(MACRO_TILE_COUNT);
  for (let t = 0; t < MACRO_TILE_COUNT; t++) {
    const tile = TILE_BY_ID[t];
    if (!tile) {
      w[t] = 1e-4;
      continue;
    }
    const sH = bandScore(height, tile.heightBand);
    const sM = bandScore(moisture, tile.moistureBand);
    const sT = bandScore(temp, tile.tempBand);
    w[t] = tile.weight * tileFrequency(tile.id, params) * (sH * sH) * sM * sT + 1e-6;
  }
  return w;
}

/** The single best tile id for a cell (used for deterministic seam-pinned borders). */
export function argmaxTile(
  height: number,
  temp: number,
  moisture: number,
  params: GenParams,
): number {
  const w = tilePriors(height, temp, moisture, params);
  let best = 0;
  for (let t = 1; t < w.length; t++) if ((w[t] ?? 0) > (w[best] ?? 0)) best = t;
  return best;
}

/**
 * Whether the WFC macro plan would mark this cell as a place rivers may rise (its
 * argmax tile has `canSpawnRiverSource`). Pure function of the fields, so identical
 * across region seams. Biases where river headwaters become visible.
 */
export function uplandSourceAllowed(
  height: number,
  temp: number,
  moisture: number,
  params: GenParams,
): boolean {
  return TILE_BY_ID[argmaxTile(height, temp, moisture, params)]?.canSpawnRiverSource ?? false;
}

/** Map visible-biome frequency controls onto the structural macro tile set. */
function tileFrequency(tile: MacroTile, params: GenParams): number {
  switch (tile) {
    case MacroTile.Ocean:
      return Math.max(0, params.biomeOceanFrequency);
    case MacroTile.Coast:
      return Math.max(0, params.biomeCoastFrequency);
    case MacroTile.Lowland:
    case MacroTile.Grassland:
      return Math.max(0, params.biomeGrasslandFrequency);
    case MacroTile.Forest:
      return Math.max(0, params.biomeForestFrequency);
    case MacroTile.Wetland:
      return Math.max(0, params.biomeWetlandFrequency);
    case MacroTile.Desert:
      return Math.max(0, params.biomeDesertFrequency);
    case MacroTile.Hills:
      return Math.max(0, params.biomeHillsFrequency);
    case MacroTile.RockyMountain:
      return Math.max(0, params.biomeRockyMountainFrequency);
    case MacroTile.SnowMountain:
      return Math.max(0, params.biomeSnowMountainFrequency);
    case MacroTile.LakeCandidate:
      return Math.max(0, params.biomeLakeFrequency);
    case MacroTile.RiverSource:
    case MacroTile.RiverCorridor:
      return Math.max(0, params.biomeRiverFrequency);
  }
}
