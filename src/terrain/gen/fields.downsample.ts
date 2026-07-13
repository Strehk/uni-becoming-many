// ── Becoming Many — Placement Field Downsampling ───────────────
//
// Reduces a chunk's authoritative per-pixel maps (size² ≈ 256²) to the coarse
// `res`² grid that scatter consumers actually need. Each layer gets the reduction
// its *semantics* demand — averaging a biome id would invent biomes that aren't
// there, and averaging a water mask would let flora creep into the shallows.
//
// PURE CPU — no three, no DOM. Worker-safe.

import type { ChunkFields } from "../worker/worldgen-protocol.ts";
import type { ChunkData } from "./mapTypes.ts";

/** Samples per chunk edge. 64 over a 256 m chunk = one sample per 4 m. */
export const FIELD_RES = 64;

/**
 * Build the downsampled placement layers for one chunk.
 *
 * Every source map is `size × size` row-major. When `size` is not a multiple of
 * `res` the block bounds simply straddle unevenly — harmless, since all three
 * reductions are order-independent.
 */
export function downsampleFields(data: ChunkData, res: number = FIELD_RES): ChunkFields {
  const size = data.size;
  const cells = res * res;

  const biome = new Uint8Array(cells);
  const vegetation = new Float32Array(cells);
  const slope = new Float32Array(cells);
  const water = new Uint8Array(cells);

  for (let cy = 0; cy < res; cy++) {
    const y0 = Math.floor((cy * size) / res);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * size) / res));

    for (let cx = 0; cx < res; cx++) {
      const x0 = Math.floor((cx * size) / res);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * size) / res));

      let vegSum = 0;
      let slopeSum = 0;
      let n = 0;
      let wet = 0;

      for (let y = y0; y < y1; y++) {
        const row = y * size;
        for (let x = x0; x < x1; x++) {
          const i = row + x;
          vegSum += data.vegetationDensityMap[i] ?? 0;
          slopeSum += data.slopeMap[i] ?? 0;
          if ((data.waterMask[i] ?? 0) !== 0) wet = 1;
          n++;
        }
      }

      // NEAREST for the discrete id: the block's centre pixel, never a mean.
      const midY = (y0 + y1 - 1) >> 1;
      const midX = (x0 + x1 - 1) >> 1;

      const c = cy * res + cx;
      biome[c] = data.biomeMap[midY * size + midX] ?? 0;
      vegetation[c] = n > 0 ? vegSum / n : 0;
      slope[c] = n > 0 ? slopeSum / n : 0;
      water[c] = wet;
    }
  }

  return { res, biome, vegetation, slope, water };
}
