// ── Becoming Many — Pass B Landform Adjacency + Priors ─────────
//
// Adjacency encodes the landform rule flavours: water is depth-monotonic
// (deep↔shelf↔shore); coast is monotonic (shore↔berm↔flat); mountains chain
// upper-slope↔ridge↔saddle↔peak with cliffs bridging slope↔valley-floor and peaks
// staying isolated; deserts order windward↔crest↔lee↔interdune.
//
// Priors are conditioned on the Pass A biome family AND the continuous field
// height, so each meso cell fills with a biome-appropriate landform at the right
// elevation. Border cells pin to the deterministic argmax so regions agree at the
// seam. PURE CPU — no three, no DOM.

import { MacroTile } from "../mapTypes.ts";
import { bandScore } from "./WfcTile.ts";
import { LANDFORM_BY_ID, LANDFORM_COUNT, Landform, type LandformFamily } from "./heightTiles.ts";

const L = Landform;

// Allowed neighbours per landform (symmetrised below; self-compat auto-added).
const ALLOW_H: Record<number, Landform[]> = {
  [L.Deep]: [L.Shelf],
  [L.Shelf]: [L.Deep, L.Shore],
  [L.Shore]: [L.Shelf, L.Berm, L.Flat, L.Interdune],
  [L.Berm]: [L.Shore, L.Flat, L.GentleRise],
  [L.Flat]: [L.Berm, L.Shore, L.GentleRise, L.GentleDip, L.Hollow, L.Interdune, L.Slope],
  [L.GentleRise]: [L.Berm, L.Flat, L.GentleDip, L.Hollow, L.Slope],
  [L.GentleDip]: [L.Flat, L.GentleRise, L.Hollow],
  [L.Hollow]: [L.Flat, L.GentleRise, L.GentleDip, L.Slope, L.ValleyFloor],
  [L.Slope]: [L.Flat, L.GentleRise, L.Hollow, L.Crest, L.UpperSlope, L.ValleyFloor, L.Cliff],
  [L.Crest]: [L.Slope, L.UpperSlope, L.Saddle],
  [L.ValleyFloor]: [L.Hollow, L.Slope, L.UpperSlope, L.Cliff],
  [L.UpperSlope]: [L.Slope, L.Crest, L.ValleyFloor, L.Ridge, L.Saddle, L.Cliff],
  [L.Ridge]: [L.UpperSlope, L.Saddle, L.Peak, L.Cliff],
  [L.Saddle]: [L.Crest, L.UpperSlope, L.Ridge, L.Peak],
  [L.Peak]: [L.Ridge, L.Saddle],
  [L.Cliff]: [L.Slope, L.ValleyFloor, L.UpperSlope, L.Ridge],
  [L.Interdune]: [L.Shore, L.Flat, L.DuneWindward, L.DuneLee],
  [L.DuneWindward]: [L.Interdune, L.DuneCrest],
  [L.DuneCrest]: [L.DuneWindward, L.DuneLee],
  [L.DuneLee]: [L.DuneCrest, L.Interdune],
};

/** compatMask[t] = bitmask of landforms compatible as a neighbour of t. */
export const COMPAT_MASK_H: number[] = (() => {
  const mask = new Array<number>(LANDFORM_COUNT).fill(0);
  const set = (a: Landform, b: Landform): void => {
    mask[a] = (mask[a] ?? 0) | (1 << b);
    mask[b] = (mask[b] ?? 0) | (1 << a);
  };
  for (let t = 0; t < LANDFORM_COUNT; t++) {
    set(t, t); // self-compatible
    for (const n of ALLOW_H[t] ?? []) set(t, n);
  }
  return mask;
})();

/** Full-domain bitmask (all landforms allowed). */
export const FULL_DOMAIN_H = (1 << LANDFORM_COUNT) - 1;

/** The landform family a Pass A macro tile belongs to (conditions Pass B priors). */
export function macroFamily(macroTile: number): LandformFamily {
  switch (macroTile) {
    case MacroTile.Ocean:
      return "water";
    case MacroTile.Coast:
      return "coast";
    case MacroTile.Desert:
      return "desert";
    case MacroTile.Hills:
    case MacroTile.RiverSource:
      return "hill";
    case MacroTile.RockyMountain:
    case MacroTile.SnowMountain:
      return "mountain";
    default:
      return "lowland"; // Lowland, Grassland, Forest, Wetland, LakeCandidate, RiverCorridor
  }
}

// Off-family tiles keep a small floor so the domain is never empty at a biome seam.
const OFF_FAMILY = 0.08;

/** Per-cell landform priors from the biome family + the field height. */
export function landformPriors(family: LandformFamily, height: number): Float32Array {
  const w = new Float32Array(LANDFORM_COUNT);
  for (let t = 0; t < LANDFORM_COUNT; t++) {
    const tile = LANDFORM_BY_ID[t];
    if (!tile) {
      w[t] = 1e-4;
      continue;
    }
    const fam = tile.family === family ? 1 : OFF_FAMILY;
    const sH = bandScore(height, tile.elevationBand, 0.1);
    w[t] = tile.weight * fam * (sH * sH) + 1e-4;
  }
  return w;
}

/** The single best landform for a cell (deterministic seam-pinned borders). */
export function argmaxLandform(family: LandformFamily, height: number): number {
  const w = landformPriors(family, height);
  let best = 0;
  for (let t = 1; t < w.length; t++) if ((w[t] ?? 0) > (w[best] ?? 0)) best = t;
  return best;
}
