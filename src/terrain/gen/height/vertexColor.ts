// ── Becoming Many — Per-vertex Terrain Colour ──────────────────
//
// Bakes an RGB albedo per vertex from the discrete biome profile (colour +
// secondary tint blended by world noise), plus rock exposure on steep/mountain
// zones and snow at altitude. Baked on the CPU in the worker so the main-thread
// material just reads a vertex-colour attribute. PURE CPU — no three, no DOM.

import type { GenParams } from "../mapTypes.ts";
import { valueNoise2D } from "../noise.ts";
import { biomeProfile, smoothstep } from "./BiomeTerrainProfiles.ts";
import type { TerrainPoint } from "./TerrainDetailGenerator.ts";

const ROCK: readonly [number, number, number] = [0.4, 0.38, 0.36];
const SNOW: readonly [number, number, number] = [0.92, 0.94, 0.98];

/** Write the linear RGB albedo for one vertex into `out` at offset `o` (3 floats). */
export function writeVertexColor(
  out: Float32Array,
  o: number,
  point: TerrainPoint,
  biome: number,
  wx: number,
  wy: number,
  params: GenParams,
  seed: number,
): void {
  const prof = biomeProfile(biome);
  // Secondary-tint variation so a biome is not one flat colour.
  const n = valueNoise2D(wx * 0.021 + 11.3, wy * 0.021 - 7.1, seed);
  let r = prof.color[0] + (prof.colorAlt[0] - prof.color[0]) * n;
  let g = prof.color[1] + (prof.colorAlt[1] - prof.color[1]) * n;
  let b = prof.color[2] + (prof.colorAlt[2] - prof.color[2]) * n;

  // Exposed rock on steep slopes / mountain flanks.
  const rk = point.rock;
  r += (ROCK[0] - r) * rk;
  g += (ROCK[1] - g) * rk;
  b += (ROCK[2] - b) * rk;

  // Snow at altitude, biased onto mountain relief so plains stay clear.
  const snow =
    smoothstep(params.snowHeight, params.snowHeight + params.snowSoftness, point.heightNorm) *
    Math.max(0.25, point.mountain);
  r += (SNOW[0] - r) * snow;
  g += (SNOW[1] - g) * snow;
  b += (SNOW[2] - b) * snow;

  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}
