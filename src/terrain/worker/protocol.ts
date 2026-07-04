// ── Becoming Many — Terrain Worker Protocol ────────────────────
//
// Plain-data messages across the worker boundary (no three / no class instances,
// so they structured-clone / transfer cleanly). The worker computes a chunk's
// per-vertex local position + normal arrays from the active provider and transfers
// them back; the main thread wraps them in a BufferGeometry.

import type { TerrainConfig } from "../provider.ts";

/** Main → worker: build one chunk's vertex data. */
export interface TerrainBuildRequest {
  type: "build";
  id: number;
  providerId: string;
  cfg: TerrainConfig;
  gridX: number;
  gridZ: number;
  chunkSize: number;
  segments: number;
}

/** Worker → main: the built vertex arrays (transferred, not copied). */
export interface TerrainBuildResult {
  type: "built";
  id: number;
  gridX: number;
  gridZ: number;
  /** (segments+1)² × 3 — chunk-local position (lx, height, lz) per vertex. */
  positions: Float32Array;
  /** (segments+1)² × 3 — world-space surface normal per vertex. */
  normals: Float32Array;
}

/** Worker → main: build failed. */
export interface TerrainBuildError {
  type: "error";
  id: number;
  message: string;
}

export type WorkerInbound = TerrainBuildRequest;
export type WorkerOutbound = TerrainBuildResult | TerrainBuildError;
