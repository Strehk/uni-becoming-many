// ── Becoming Many — Terrain Public Facade ──────────────────────
//
// createTerrainWorld(opts) → TerrainWorld: the streamed, chunked, worker-driven
// terrain. main.ts calls this after the renderer exists, adds `world.group` to the
// scene (done internally), and calls `world.update(x, z)` each frame with the
// player rig's world XZ.

import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { TerrainConfig } from "./provider.ts";
import { DEFAULT_PROVIDER_ID, getTerrainProvider } from "./providers/index.ts";
import type { TerrainLayerCompositor } from "./render/terrain-material.ts";
import { type KitUniforms, createSenseUniforms } from "./render/uniforms.ts";
import type { StreamingConfig } from "./scheduler.ts";
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
  /** Optional sense-layer compositor (ShaderSinne port) layered over the biome albedo. */
  layers?: TerrainLayerCompositor;
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
    ...(opts.layers ? { layers: opts.layers } : {}),
  });
  return { world, uniforms };
}

export { TerrainWorld, type SenseSource } from "./world.ts";
export type { BiomeChunkSource, BiomeChunkView } from "./world.ts";
export type { TerrainConfig, TerrainProvider } from "./provider.ts";
export type { StreamingConfig } from "./scheduler.ts";
export { createSenseUniforms, type KitUniforms } from "./render/uniforms.ts";
export type { TerrainLayerCompositor, TerrainSurfaceNodes } from "./render/terrain-material.ts";
export { DEFAULT_PROVIDER_ID } from "./providers/index.ts";
