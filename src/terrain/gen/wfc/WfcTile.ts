// ── Becoming Many — Macro WFC Tile Definition ──────────────────
//
// Tiles plan the large-scale structure only (one tile per macro cell), never per
// pixel. Each carries terrain bands, water/river/coast roles, source/lake
// capability, a weight, and a preferred noise profile. PURE CPU — no three, no DOM.

import type { MacroTile } from "../mapTypes.ts";

export type Band = [number, number]; // inclusive [lo, hi] in normalised 0..1

export interface WfcTile {
  id: MacroTile;
  name: string;
  family: string;
  heightBand: Band;
  moistureBand: Band;
  tempBand: Band;
  water: boolean;
  river: boolean;
  coast: boolean;
  canSpawnRiverSource: boolean;
  canContainLake: boolean;
  weight: number;
  noiseProfile: "flat" | "rolling" | "dunes" | "ridged" | "fbm";
}

const ANY: Band = [0, 1];

/**
 * Smooth membership of a value in a band: 1 inside, linear falloff over `soft`
 * outside. Turns continuous (height,temp,moisture) into per-tile priors.
 */
export function bandScore(v: number, band: Band, soft = 0.14): number {
  const [lo, hi] = band;
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
}

export { ANY };
