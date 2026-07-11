// ── Becoming Many — WorldGen Worker Protocol ───────────────────
//
// Plain-data messages for the dedicated worldgen worker. Kept separate from
// protocol.ts so the lightweight pointwise worker bundle never pulls in the
// worldgen config/generation. The build request carries the flat TerrainConfig
// (the worker folds it onto GenParams); the result carries the per-vertex arrays,
// transferred (not copied).

import type { TerrainConfig } from "../provider.ts";

/**
 * The chunk's placement layers, downsampled from the worker's authoritative per-pixel maps
 * (which are `params.chunkSize`² ≈ 256², far finer than any scatter needs). Row-major `res`²;
 * at res 64 over a 256 m chunk that is one sample per 4 m, and ~40 KB per chunk all told —
 * cheap enough to transfer every build, unlike the ~640 KB of raw maps.
 *
 * Terrain publishes these as its own semantic layers (like the per-vertex `biome` the minimap
 * reads); consumers such as `src/life/` scatter against them without terrain knowing they exist.
 */
export interface ChunkFields {
  /** Samples per chunk edge. */
  res: number;
  /** Biome id per cell — reduced by NEAREST (a discrete id must never be averaged). */
  biome: Uint8Array;
  /** Vegetation density 0..1 per cell — reduced by MEAN. */
  vegetation: Float32Array;
  /** Surface slope 0..1 per cell — reduced by MEAN. */
  slope: Float32Array;
  /** 1 where any source pixel held water — reduced by MAX, so flora is kept off shorelines. */
  water: Uint8Array;
}

/** Main → worker: build one chunk. The worker re-applies cfg if it changed. */
export interface WorldgenBuildRequest {
  type: "build";
  id: number;
  cfg: TerrainConfig;
  /** Live GenParams overlay (dev GUI), merged on top of configToParams. */
  params?: Record<string, number>;
  gridX: number;
  gridZ: number;
  chunkSize: number;
  segments: number;
}

/** Worker → main: the built per-vertex arrays (all four buffers transferred). */
export interface WorldgenBuildResult {
  type: "built";
  id: number;
  gridX: number;
  gridZ: number;
  positions: Float32Array;
  normals: Float32Array;
  biome: Uint8Array;
  /** Per-vertex linear RGB albedo (biome + rock + snow). */
  colors: Float32Array;
  heightGrid: Float32Array;
  /** Downsampled placement layers for scatter consumers (flora, creatures). */
  fields: ChunkFields;
  /** Non-indexed water mesh (ocean + lakes + rivers); absent until Phase 5. */
  waterPositions?: Float32Array;
  /** Per-vertex water colour (depth/foam tint); paired with waterPositions. */
  waterColors?: Float32Array;
}

/** Worker → main: build failed. */
export interface WorldgenBuildError {
  type: "error";
  id: number;
  message: string;
}

export type WorldgenInbound = WorldgenBuildRequest;
export type WorldgenOutbound = WorldgenBuildResult | WorldgenBuildError;
