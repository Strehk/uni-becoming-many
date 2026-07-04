// ── Becoming Many — Pass B Landform Plan (per region) ──────────
//
// Runs the second WFC pass over a "meso" grid finer than the macro grid (each
// macro cell subdivided m×m). Each meso cell's priors are conditioned on the
// Pass A biome family (from the parent macro tile) and the continuous field
// height, so mountain cells fill with peak/ridge/cliff, desert cells with dunes,
// etc. The border ring is pinned to the deterministic argmax landform so adjacent
// regions agree at the seam. The output is the landform tile grid plus a per-cell
// target elevation (the tile band midpoint) that the synthesizer interpolates.
//
// PURE CPU — no three, no DOM.

import { baseHeight01 } from "../fields.ts";
import type { GenParams } from "../mapTypes.ts";
import { deriveSeed, mulberry32, seedToOffset } from "../rng.ts";
import type { WfcSolver } from "../wfc/WfcSolver.ts";
import {
  COMPAT_MASK_H,
  FULL_DOMAIN_H,
  argmaxLandform,
  landformPriors,
  macroFamily,
} from "../wfc/heightConstraints.ts";
import { LANDFORM_COUNT, LANDFORM_ELEVATION } from "../wfc/heightTiles.ts";

export interface LandformPlan {
  /** Landform tile id per meso cell, (RM·m)² row-major. */
  tiles: Uint8Array;
  /** Target elevation (0..1) per meso cell — the chosen tile's band midpoint. */
  elevation: Float32Array;
  /** Meso subdivisions per macro cell edge (m). */
  m: number;
}

export function buildLandformPlan(
  rx: number,
  ry: number,
  params: GenParams,
  macroTiles: Uint8Array,
  solver: WfcSolver,
): LandformPlan {
  const RM = params.macroResolution;
  const cs = params.macroCellSize;
  const m = Math.max(1, Math.round(params.mesoSubdiv));
  const MW = RM * m; // meso cells per region edge
  const mesoSize = cs / m; // world px per meso cell
  const n = MW * MW;
  const seedOffset = seedToOffset(params.seed);

  const priors = new Float32Array(n * LANDFORM_COUNT);
  const pinned = new Int16Array(n).fill(-1);
  for (let mly = 0; mly < MW; mly++) {
    for (let mlx = 0; mlx < MW; mlx++) {
      const i = mly * MW + mlx;
      // Parent macro tile → biome family.
      const mcx = Math.floor(mlx / m);
      const mcy = Math.floor(mly / m);
      const family = macroFamily(macroTiles[mcy * RM + mcx] ?? 0);
      // Field height at the meso cell centre.
      const wx = (rx * MW + mlx + 0.5) * mesoSize;
      const wy = (ry * MW + mly + 0.5) * mesoSize;
      const height = baseHeight01(wx, wy, seedOffset, params);
      priors.set(landformPriors(family, height), i * LANDFORM_COUNT);
      if (mlx === 0 || mly === 0 || mlx === MW - 1 || mly === MW - 1) {
        pinned[i] = argmaxLandform(family, height);
      }
    }
  }

  const rng = mulberry32(deriveSeed(params.seed, rx, ry, 0x8b2));
  const tiles = solver.solve({
    w: MW,
    h: MW,
    tileCount: LANDFORM_COUNT,
    compatMask: COMPAT_MASK_H,
    fullDomain: FULL_DOMAIN_H,
    priors,
    pinned,
    rng,
  });

  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) elevation[i] = LANDFORM_ELEVATION[tiles[i] ?? 0] ?? 0.5;

  return { tiles, elevation, m };
}
