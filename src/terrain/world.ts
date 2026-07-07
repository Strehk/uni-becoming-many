// ── Becoming Many — Streaming Terrain World ────────────────────
//
// Owns the streamed chunked terrain: the generic ChunkScheduler, the generation
// transport, one shared sense material, a shared grid index, and the active
// TerrainProvider + config. Generation is CPU-in-worker (no GPU compute), so no
// per-chunk pipeline build → no streaming hitch.
//
// Phase 1 supports "pointwise" providers (sine/ridged) via a round-robin
// TerrainWorkerPool; the flight floor samples provider.height directly. The
// "chunk" (worldgen) transport + ChunkHeightCache path is added in Phase 2.
//
// Modularity payoff:
//   - setProvider(id)  → swap the terrain algorithm live; chunks rebuild.
//   - setConfig(patch) → tweak seed/amplitude/…; chunks rebuild.
//   - sampleHeight(x,z) → the flight floor matches the surface.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": classes from `three/webgpu`.

import * as THREE from "three/webgpu";
import type { MeshBasicNodeMaterial, MeshStandardNodeMaterial, Node } from "three/webgpu";
import { TerrainChunk } from "./chunk.ts";
import { ChunkHeightCache } from "./height-cache.ts";
import type { TerrainConfig, TerrainProvider } from "./provider.ts";
import { getTerrainProvider } from "./providers/index.ts";
import { createTerrainMaterial } from "./render/terrain-material.ts";
import type { KitUniforms } from "./render/uniforms.ts";
import { createWaterMaterial } from "./render/water-material.ts";
import { ChunkScheduler, type StreamingConfig } from "./scheduler.ts";
import { TerrainWorkerPool } from "./worker/pool.ts";
import { WorldgenClient } from "./worker/worldgen-client.ts";

// Streaming defaults, tuned for smooth streaming over raw coverage: big 256 m
// chunks (rare build events, fewer draws), buildRadius 2 ≈ 640 m coverage, 40
// segments ≈ 6.4 m/vertex, one build initiated per frame.
const DEFAULT_STREAMING: StreamingConfig = {
  chunkSize: 256,
  terrainSegments: 40,
  anchorStepCells: 1,
  buildRadius: 2,
  keepRadius: 3,
  maxBuildsPerFrame: 1,
};

/** Minimal perception input the world reads to modulate the sense look. Kept
 *  structural so the terrain module never imports the senses module (modularity). */
export interface SenseSource {
  readonly pointer: { x: number; y: number };
}

/** One active chunk, as read by debug overlays. TerrainChunk satisfies this
 *  structurally, so no class import leaks to the consumer. */
export interface BiomeChunkView {
  readonly gridX: number;
  readonly gridZ: number;
  /** Per-vertex biome id, (segments+1)² row-major; absent for pointwise providers. */
  readonly biome?: Uint8Array;
}

/** Read-only view of the streamed world for debug overlays (e.g. the biome
 *  minimap). Structural on purpose so consumers never import TerrainWorld. */
export interface BiomeChunkSource {
  readonly chunkSize: number;
  readonly segments: number;
  chunks(): Iterable<BiomeChunkView>;
}

export interface TerrainWorldOptions {
  scene: THREE.Scene;
  /** Live sense uniforms (shared with the rest of the experience). */
  uniforms: KitUniforms;
  /** Clock uniform node for the material's rim breath. */
  uTime: Node<"float">;
  /** Provider the world opens with. */
  provider: TerrainProvider;
  /** Config overrides folded onto the provider's defaults. */
  config?: Partial<TerrainConfig>;
  /** Streaming overrides (chunk size / radii / budget). */
  streaming?: Partial<StreamingConfig>;
  /** Optional perception input; when present, `update` modulates the sense look. */
  senses?: SenseSource;
}

export class TerrainWorld {
  /** Parent of all chunk meshes; added to the scene in the constructor. */
  readonly group: THREE.Group;

  private readonly material: MeshStandardNodeMaterial;
  /** Shared water material (ocean + lakes + rivers); used by chunk providers. */
  private readonly waterMaterial: MeshBasicNodeMaterial;
  /** Live sense uniforms — modulated per frame when a SenseSource is wired. */
  private readonly uniforms: KitUniforms;
  private readonly senses?: SenseSource;
  private readonly scheduler: ChunkScheduler<TerrainChunk>;
  private readonly chunkSize: number;
  private readonly segments: number;
  /** Shared grid index (same topology for every chunk). */
  private readonly indexArray: Uint16Array | Uint32Array;
  /** Flight-floor source for chunk providers (baked per-chunk height grids). */
  private readonly heightCache: ChunkHeightCache;

  /** Transports, created lazily for whichever provider kind is active. */
  private pool?: TerrainWorkerPool;
  private worldgen?: WorldgenClient;

  private provider: TerrainProvider;
  private cfg: TerrainConfig;

  constructor(opts: TerrainWorldOptions) {
    this.group = new THREE.Group();
    opts.scene.add(this.group);

    // Scene lighting for the PBR terrain material. The app scene ships no lights,
    // so the world provides its own (parented to the group → disposed with it): a
    // hemisphere fill (sky/ground ambient) plus a low directional "sun" for form.
    // Provisional — a later phase can lift this to app level alongside the senses.
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2620, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.6, 1, 0.4);
    this.group.add(hemi, sun);

    this.material = createTerrainMaterial(opts.uniforms, opts.uTime);
    this.waterMaterial = createWaterMaterial(opts.uniforms, opts.uTime);
    this.uniforms = opts.uniforms;
    if (opts.senses) this.senses = opts.senses;
    this.provider = opts.provider;
    this.cfg = { ...opts.provider.defaultConfig, ...opts.config };

    const streaming: StreamingConfig = { ...DEFAULT_STREAMING, ...opts.streaming };
    this.chunkSize = streaming.chunkSize;
    this.segments = streaming.terrainSegments;
    this.heightCache = new ChunkHeightCache(this.chunkSize);

    // Build the grid index once from a throwaway plane and reuse its array.
    this.indexArray = buildGridIndex(this.segments);

    this.scheduler = new ChunkScheduler<TerrainChunk>({
      config: streaming,
      buildChunk: (gx, gz) => this.buildChunk(gx, gz),
      onChunkBuilt: (chunk) => {
        this.group.add(chunk.mesh);
        if (chunk.heightGrid) this.heightCache.add(chunk.gridX, chunk.gridZ, chunk.heightGrid);
      },
      onChunkDisposed: (chunk) => this.heightCache.remove(chunk.gridX, chunk.gridZ),
    });
  }

  /** Stream around the player. Call once per frame with world XZ. */
  update(x: number, z: number): void {
    this.scheduler.update(x, z);
    // Sense look: the pointer modulates the view bubble + edge glow live, so the
    // world's read of space responds to attention (spec §4). Static when unwired.
    if (this.senses) {
      const p = this.senses.pointer;
      const py = Math.min(1, Math.max(0, p.y));
      const px = Math.min(1, Math.max(0, p.x));
      this.uniforms.viewRadius.value = 280 - py * 170; // top = far sight, bottom = near
      this.uniforms.rimStrength.value = 0.3 + px * 0.6; // left→right = softer→brighter rim
    }
  }

  /** World ground height — the flight floor + gameplay sampling source. */
  sampleHeight(x: number, z: number): number {
    if (this.provider.kind === "chunk") return this.heightCache.sample(x, z);
    return this.provider.height ? this.provider.height(x, z, this.cfg) : 0;
  }

  /** Ground height at (x,z), or `null` when no surface is known there yet — the
   *  owning chunk hasn't streamed in (chunk providers) or the provider is
   *  height-less. The flight floor uses this to avoid clamping over the void. */
  groundHeightAt(x: number, z: number): number | null {
    if (this.provider.kind === "chunk") return this.heightCache.sampleOrNull(x, z);
    return this.provider.height ? this.provider.height(x, z, this.cfg) : null;
  }

  /** Swap the terrain algorithm live; rebuilds every chunk. Keeps the current
   *  config (shared shape) unless `config` overrides fields. */
  setProvider(id: string, config?: Partial<TerrainConfig>): void {
    this.provider = getTerrainProvider(id);
    if (config) this.cfg = { ...this.cfg, ...config };
    this.rebuild();
  }

  /** Tweak the active provider's config (seed/amplitude/…); rebuilds chunks. */
  setConfig(patch: Partial<TerrainConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.rebuild();
  }

  get providerId(): string {
    return this.provider.id;
  }

  /** Read-only view of active chunks + tiling for debug overlays (e.g. the biome
   *  minimap). `chunks()` returns the live active-set iterator, so it reflects
   *  streaming with zero allocation. */
  get biomeSource(): BiomeChunkSource {
    return {
      chunkSize: this.chunkSize,
      segments: this.segments,
      chunks: () => this.scheduler.chunks(),
    };
  }

  dispose(): void {
    this.scheduler.clearAll();
    this.pool?.dispose();
    this.worldgen?.dispose();
    this.heightCache.clear();
    this.group.removeFromParent();
    this.material.dispose();
    this.waterMaterial.dispose();
  }

  /** Drop all chunks + cached heights; the next update re-streams with current
   *  provider/config. */
  private rebuild(): void {
    this.scheduler.clearAll();
    this.heightCache.clear();
  }

  private ensurePool(): TerrainWorkerPool {
    if (!this.pool) this.pool = new TerrainWorkerPool();
    return this.pool;
  }

  private ensureWorldgen(): WorldgenClient {
    if (!this.worldgen) this.worldgen = new WorldgenClient();
    return this.worldgen;
  }

  private async buildChunk(gridX: number, gridZ: number): Promise<TerrainChunk> {
    // "chunk" providers (worldgen) own their whole per-region/per-chunk pipeline
    // and bake per-vertex height/normal/biome + a height grid for the flight floor.
    if (this.provider.kind === "chunk") {
      const r = await this.ensureWorldgen().build(
        this.cfg,
        gridX,
        gridZ,
        this.chunkSize,
        this.segments,
      );
      return new TerrainChunk({
        gridX: r.gridX,
        gridZ: r.gridZ,
        chunkSize: this.chunkSize,
        positions: r.positions,
        normals: r.normals,
        heightGrid: r.heightGrid,
        biome: r.biome,
        colors: r.colors,
        index: this.indexArray,
        material: this.material,
        waterMaterial: this.waterMaterial,
        ...(r.waterPositions ? { waterPositions: r.waterPositions } : {}),
        ...(r.waterColors ? { waterColors: r.waterColors } : {}),
      });
    }

    // "pointwise" providers (sine/ridged): the shared worker grid loop samples
    // provider.height; the flight floor samples provider.height directly.
    const r = await this.ensurePool().build(
      this.provider.id,
      this.cfg,
      gridX,
      gridZ,
      this.chunkSize,
      this.segments,
    );
    return new TerrainChunk({
      gridX: r.gridX,
      gridZ: r.gridZ,
      chunkSize: this.chunkSize,
      positions: r.positions,
      normals: r.normals,
      index: this.indexArray,
      material: this.material,
    });
  }
}

/** Build the shared row-major triangle index for a (segments+1)² grid, reusing
 *  three's PlaneGeometry topology (a throwaway plane, its index array kept). */
function buildGridIndex(segments: number): Uint16Array | Uint32Array {
  const template = new THREE.PlaneGeometry(1, 1, segments, segments);
  const index = template.index;
  if (!index) {
    template.dispose();
    throw new Error("PlaneGeometry produced no index");
  }
  const array = index.array;
  template.dispose();
  if (array instanceof Uint16Array || array instanceof Uint32Array) return array;
  // PlaneGeometry always indexes with a Uint16/Uint32 array; normalise defensively.
  return Uint32Array.from(array);
}
