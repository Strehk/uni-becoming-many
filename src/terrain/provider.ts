// ── Becoming Many — Terrain Provider Contract ──────────────────
//
// A terrain *algorithm* is a TerrainProvider: a pure-CPU height field over world
// XZ. Generation runs in a Web Worker (terrain/worker/), so the provider must be
// plain math with no renderer/three imports — that keeps it importable in the
// worker bundle AND on the main thread (for the flight floor + decorations).
//
//   - height(x, z, cfg) → world ground height. Used by the worker to build chunk
//     geometry, and on the main thread for flight altitude + decoration placement.
//
// A flat numeric TerrainConfig (seed/amplitude/frequency/octaves) maps 1:1 onto
// the Settings sliders. Providers are registered in providers/registry.ts; the
// worker imports providers/index.ts so the built-ins exist in its bundle.

/**
 * Flat, numeric config shared by every provider (keeps the registry generic and
 * maps onto the numeric Settings sliders). Each provider reads the fields it
 * cares about and ignores the rest.
 */
export interface TerrainConfig {
  /** Master seed — providers fold it in so worlds differ. */
  seed: number;
  /** Overall vertical scale (metres), multiplies the raw field. */
  amplitude: number;
  /** Base horizontal frequency (lower = broader features). */
  frequency: number;
  /** Octave count for fractal providers (ignored by simple ones). */
  octaves: number;
}

/**
 * What a *chunk provider* returns for one chunk — plain typed arrays that
 * structured-clone / transfer cleanly across the worker boundary. Vertex order
 * is row-major over a (segments+1)² grid (same layout the pointwise worker uses),
 * so the main thread can wrap them with the shared grid index unchanged.
 */
export interface ChunkVertexData {
  /** (segments+1)² × 3 — chunk-local position (lx, worldY, lz) per vertex. */
  positions: Float32Array;
  /** (segments+1)² × 3 — world-space surface normal per vertex (Y-up). */
  normals: Float32Array;
  /** (segments+1)² — per-vertex biome id (reserved for biome-aware senses). */
  biome: Uint8Array;
  /** (segments+1)² × 3 — per-vertex linear RGB albedo (biome + rock + snow). */
  colors: Float32Array;
  /** (segments+1)² — world-Y per vertex; the main-thread flight-floor source. */
  heightGrid: Float32Array;
}

/** Grid parameters for a single chunk build (mirrors the worker protocol). */
export interface ChunkBuildParams {
  gridX: number;
  gridZ: number;
  chunkSize: number;
  segments: number;
}

/**
 * A terrain algorithm. Two kinds:
 *   - "pointwise" (default): implements `height(x,z,cfg)`. The shared worker grid
 *     loop builds geometry from it, and the flight floor samples it directly.
 *   - "chunk": owns its own (region-cached, neighbourhood-dependent) generation
 *     and produces whole-chunk vertex buffers. The world routes these to the
 *     dedicated worldgen worker and samples the flight floor from the built
 *     height grids (there is no cheap pointwise height). `height` is omitted.
 */
export interface TerrainProvider {
  /** Stable id — used by the registry + the provider Settings enum. */
  readonly id: string;
  /** Human label for UI / logs. */
  readonly label: string;
  /** Config this provider ships with; the world clones it as the live config. */
  readonly defaultConfig: TerrainConfig;

  /** Provider flavour. Absent ⇒ "pointwise" (back-compat). */
  readonly kind?: "pointwise" | "chunk";

  /**
   * World ground height at (x, z) — the single source of truth for the surface.
   * Required for pointwise providers; chunk providers omit it (they generate in
   * the worker and the world samples a cached height grid instead).
   */
  height?(x: number, z: number, cfg: TerrainConfig): number;
}
