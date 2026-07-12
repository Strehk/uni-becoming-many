// ── Becoming Many — Terrain Chunk ──────────────────────────────
//
// One streamed terrain tile. Its vertex data is generated off the main thread and
// arrives as plain position + normal Float32Arrays; this wraps them in a
// BufferGeometry (sharing a single grid index across all chunks) drawn by the
// shared sense material. No GPU compute, so no per-chunk pipeline build — that was
// the streaming hitch.
//
// The chunk is provider-agnostic: it takes a plain params object (TerrainWorld
// builds it from whichever transport produced the vertex data). Chunk providers
// also pass a per-vertex `heightGrid` (kept for the flight-floor cache) and a
// `biome` array (reserved for biome-aware senses; not rendered yet).
//
// IMPORTANT — see AGENT.md "WebGPU rendering": classes from `three/webgpu`.

import * as THREE from "three/webgpu";
import type { MeshBasicNodeMaterial } from "three/webgpu";
import { cellToWorldCenter } from "./coords.ts";
import type { ChunkLike } from "./scheduler.ts";

export interface TerrainChunkParams {
  gridX: number;
  gridZ: number;
  chunkSize: number;
  /** (segments+1)² × 3 — chunk-local position (lx, y, lz) per vertex. */
  positions: Float32Array;
  /** (segments+1)² × 3 — world-space surface normal per vertex. */
  normals: Float32Array;
  /** Shared grid index (same topology for every chunk). */
  index: Uint16Array | Uint32Array;
  material: MeshBasicNodeMaterial;
  /** World-Y per vertex — chunk providers supply it for the flight-floor cache. */
  heightGrid?: Float32Array;
  /** Per-vertex biome id — reserved for biome-aware senses (not rendered yet). */
  biome?: Uint8Array;
  /** Per-vertex linear RGB albedo. Chunk providers supply it; pointwise providers
   *  omit it (a neutral default is filled so the material always has "color"). */
  colors?: Float32Array;
  /** Non-indexed water vertex positions (chunk-local); chunk providers only. */
  waterPositions?: Float32Array;
  /** Per-vertex water colour, paired with waterPositions. */
  waterColors?: Float32Array;
  /** Shared water material (required if waterPositions is present). */
  waterMaterial?: MeshBasicNodeMaterial;
}

export class TerrainChunk implements ChunkLike {
  readonly gridX: number;
  readonly gridZ: number;
  readonly mesh: THREE.Mesh;
  /** Kept so TerrainWorld can register it in the flight-floor cache. */
  readonly heightGrid?: Float32Array;
  /** Reserved for biome-aware senses; unused this slice. */
  readonly biome?: Uint8Array;

  private readonly geometry: THREE.BufferGeometry;
  private readonly waterMesh: THREE.Mesh | null = null;

  constructor(p: TerrainChunkParams) {
    this.gridX = p.gridX;
    this.gridZ = p.gridZ;
    if (p.heightGrid) this.heightGrid = p.heightGrid;
    if (p.biome) this.biome = p.biome;

    // Wrap the worker's arrays. The index is shared (same grid topology for every
    // chunk); each chunk gets its own BufferAttribute over it so dispose frees
    // only this chunk's GPU index buffer.
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(p.normals, 3));
    // The material always reads a "color" attribute; pointwise providers that ship
    // no per-vertex colours get a neutral fill so the graph stays valid.
    const colors = p.colors ?? defaultColors(p.positions.length / 3);
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(p.index, 1));
    // Local positions are real, so the bounding sphere is valid → off-screen
    // chunks frustum-cull normally.
    this.geometry.computeBoundingSphere();

    const centerX = cellToWorldCenter(p.gridX, p.chunkSize);
    const centerZ = cellToWorldCenter(p.gridZ, p.chunkSize);

    this.mesh = new THREE.Mesh(this.geometry, p.material);
    this.mesh.position.set(centerX, 0, centerZ);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    // Water (ocean + lakes + river ribbons). Non-indexed, chunk-local coords like
    // the terrain, parented under the terrain mesh so it streams with it. Rendered
    // after the land (transparent, no depth write).
    if (p.waterPositions && p.waterPositions.length > 0 && p.waterColors && p.waterMaterial) {
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute("position", new THREE.BufferAttribute(p.waterPositions, 3));
      wgeo.setAttribute("color", new THREE.BufferAttribute(p.waterColors, 3));
      wgeo.computeBoundingSphere();
      this.waterMesh = new THREE.Mesh(wgeo, p.waterMaterial);
      this.waterMesh.renderOrder = 2;
      this.waterMesh.matrixAutoUpdate = false;
      this.waterMesh.updateMatrix();
      this.mesh.add(this.waterMesh);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    // Water geometry is per-chunk; the shared water material is owned by the world.
    this.waterMesh?.geometry.dispose();
  }
}

/** Neutral mid-gray vertex colours for providers that ship none. */
function defaultColors(vertexCount: number): Float32Array {
  const colors = new Float32Array(vertexCount * 3);
  colors.fill(0.5);
  return colors;
}
