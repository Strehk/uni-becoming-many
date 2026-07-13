// ── Becoming Many — Chunk Scatter ──────────────────────────────
//
// Decides where one species stands within one chunk, by rejection-sampling the
// terrain's own placement layers: a candidate survives if the ground is dry enough,
// flat enough, the biome will have it, and the vegetation density rolls in its
// favour. Deterministic — the same chunk always grows the same forest.
//
// Runs on the main thread. The scheduler starts at most one chunk build per frame
// (`maxBuildsPerFrame: 1`), so this never bursts; a full 15-species pass is a few
// thousand array reads and lands well inside a frame.
//
// Ground height comes from `sampleEntry` over the chunk's own `heightGrid` — the
// same bilinear read of the same data the mesh was built from, so a tree's foot is
// exactly on the rendered surface rather than on a re-evaluation of it.

import {
  BIOME_COUNT,
  type ChunkBuiltInfo,
  type HeightEntry,
  sampleEntry,
} from "../terrain/index.ts";
import { TAU, chunkSeed, composeMatrix, mulberry32 } from "./matrix.ts";
import type { SpeciesDef } from "./species.ts";

/**
 * How many candidates we test per slot before giving up. The loop breaks the moment
 * the cap is filled, so a favourable biome pays little of this; the headroom only
 * matters in mixed chunks, where more tries let a species actually reach its cap
 * instead of thinning out because half the candidates fell on the wrong biome.
 */
const ATTEMPTS_PER_SLOT = 8;
/** Maximum lean off vertical, radians. Enough to look grown, not enough to look broken. */
const MAX_TILT = 0.05;

/** One chunk's worth of placed instances for one species. */
export interface ScatterBlock {
  /** Instances actually placed, ≤ `def.perChunkCap`. */
  count: number;
  /** `perChunkCap * 16` column-major mat4s; only the first `count` are meaningful. */
  matrices: Float32Array;
  /** `perChunkCap` per-instance albedo multipliers around 1.0. */
  jitter: Float32Array;
}

/** Per-species biome affinity as a dense lookup — avoids indexing a numeric-enum
 *  Record with a runtime `number` (which strict TS rightly rejects). */
export function biomeAffinityTable(def: SpeciesDef): Float32Array {
  const table = new Float32Array(BIOME_COUNT);
  for (const [key, value] of Object.entries(def.biomes)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < BIOME_COUNT && value !== undefined) {
      table[index] = value;
    }
  }
  return table;
}

export function scatterChunk(
  info: ChunkBuiltInfo,
  entry: HeightEntry,
  def: SpeciesDef,
  affinity: Float32Array,
  speciesIndex: number,
): ScatterBlock {
  const cap = def.perChunkCap;
  const matrices = new Float32Array(cap * 16);
  const jitter = new Float32Array(cap);

  const { fields, chunkSize } = info;
  const res = fields.res;
  const originX = info.gridX * chunkSize;
  const originZ = info.gridZ * chunkSize;

  const rand = mulberry32(chunkSeed(info.gridX, info.gridZ, speciesIndex));
  const [scaleMin, scaleMax] = def.scale;

  let count = 0;
  const attempts = cap * ATTEMPTS_PER_SLOT;

  for (let a = 0; a < attempts && count < cap; a++) {
    const u = rand();
    const v = rand();

    // Field cell under the candidate.
    const cx = Math.min(res - 1, Math.floor(u * res));
    const cz = Math.min(res - 1, Math.floor(v * res));
    const cell = cz * res + cx;

    if ((fields.water[cell] ?? 1) !== 0) continue; // never plant in water

    const slope = fields.slope[cell] ?? 1;
    if (slope > def.maxSlope) continue;

    const affinityHere = affinity[fields.biome[cell] ?? 0] ?? 0;
    if (affinityHere <= 0) continue;

    const density = fields.vegetation[cell] ?? 0;
    // Taper toward the slope limit so tree lines thin out rather than stopping dead.
    const slopeGate = 1 - slope / def.maxSlope;
    const probability = density * affinityHere * slopeGate;
    if (rand() > probability) continue;

    const worldX = originX + u * chunkSize;
    const worldZ = originZ + v * chunkSize;
    const worldY = sampleEntry(entry, worldX, worldZ);

    const scale = scaleMin + (scaleMax - scaleMin) * rand();
    const yaw = rand() * TAU;
    const tiltX = (rand() - 0.5) * 2 * MAX_TILT;
    const tiltZ = (rand() - 0.5) * 2 * MAX_TILT;

    composeMatrix(
      matrices,
      count * 16,
      worldX,
      worldY,
      worldZ,
      tiltX,
      yaw,
      tiltZ,
      scale,
      scale,
      scale,
    );
    jitter[count] = 1 + (rand() * 2 - 1) * def.tintJitter;
    count++;
  }

  return { count, matrices, jitter };
}
