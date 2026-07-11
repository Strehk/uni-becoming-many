// ── Becoming Many — Terrain Public Facade ──────────────────────
//
// createTerrainWorld(opts) → TerrainWorld: the streamed, chunked, worker-driven
// terrain. main.ts calls this after the renderer exists, adds `world.group` to the
// scene (done internally), and calls `world.update(x, z)` each frame with the
// player rig's world XZ.

import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { type KitUniforms, createSenseUniforms } from "../render/uniforms.ts";
import type { TerrainConfig } from "./provider.ts";
import { DEFAULT_PROVIDER_ID, getTerrainProvider } from "./providers/index.ts";
import type { StreamingConfig } from "./scheduler.ts";
import type { ChunkBuiltInfo, ChunkCell } from "./world.ts";
import { type SenseSource, TerrainWorld } from "./world.ts";

export interface CreateTerrainWorldOptions {
  scene: THREE.Scene;
  /** Clock uniform node for the material's rim breath (e.g. TSL `time`). */
  uTime: Node<"float">;
  /** Provider id to open with. Defaults to the registry's default. */
  providerId?: string;
  /** Config overrides folded onto the provider's defaults. */
  config?: Partial<TerrainConfig>;
  /** Streaming overrides (chunk size / radii / budget). */
  streaming?: Partial<StreamingConfig>;
  /** Sense uniforms to share; a fresh set is created if omitted. */
  uniforms?: KitUniforms;
  /** Optional perception input; when present the world modulates the sense look. */
  senses?: SenseSource;
  /** Fired after a chunk streams in, carrying its placement layers (see `src/life/`). */
  onChunkBuilt?: (info: ChunkBuiltInfo) => void;
  /** Fired after a chunk streams out, so consumers can free what they placed on it. */
  onChunkDisposed?: (cell: ChunkCell) => void;
}

export interface CreateTerrainWorldResult {
  world: TerrainWorld;
  /** The live sense uniforms (shared with the rest of the experience). */
  uniforms: KitUniforms;
}

/** Create the streaming terrain world and add its group to the scene. */
export function createTerrainWorld(opts: CreateTerrainWorldOptions): CreateTerrainWorldResult {
  const uniforms = opts.uniforms ?? createSenseUniforms();
  const provider = getTerrainProvider(opts.providerId ?? DEFAULT_PROVIDER_ID);
  const world = new TerrainWorld({
    scene: opts.scene,
    uniforms,
    uTime: opts.uTime,
    provider,
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.streaming ? { streaming: opts.streaming } : {}),
    ...(opts.senses ? { senses: opts.senses } : {}),
    ...(opts.onChunkBuilt ? { onChunkBuilt: opts.onChunkBuilt } : {}),
    ...(opts.onChunkDisposed ? { onChunkDisposed: opts.onChunkDisposed } : {}),
  });
  return { world, uniforms };
}

export { TerrainWorld, type SenseSource } from "./world.ts";
export type { BiomeChunkSource, BiomeChunkView, ChunkBuiltInfo, ChunkCell } from "./world.ts";
export type { ChunkFields } from "./worker/worldgen-protocol.ts";
export { Biome, BIOME_COUNT } from "./gen/mapTypes.ts";
// The exact bilinear read of the exact height grid the mesh was built from — so
// anything placed against it sits on the rendered surface, with no re-eval drift.
export { makeHeightEntry, sampleEntry, type HeightEntry } from "./height-cache.ts";
export type { TerrainConfig, TerrainProvider } from "./provider.ts";
export type { StreamingConfig } from "./scheduler.ts";
export { createSenseUniforms, type KitUniforms } from "../render/uniforms.ts";
export { DEFAULT_PROVIDER_ID } from "./providers/index.ts";
