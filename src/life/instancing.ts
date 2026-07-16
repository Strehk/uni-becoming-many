// ── Becoming Many — Species Instancing (per-chunk, frustum-culled) ─────
//
// One InstancedMesh PER (species-part × live chunk). Each chunk mesh:
//   - shares the part's shape (position/normal/index/uv) BY REFERENCE — no clone,
//     so 49 chunks of a species cost one copy of the geometry, not 49;
//   - owns small per-chunk instance buffers (matrix + tint + thermal), sized to the
//     chunk's actual instance count (no phantom instances);
//   - carries a tight bounding sphere over the chunk's footprint and is
//     `frustumCulled = true`, so three skips every chunk outside the view cone —
//     the "only draw what you look at" that game engines do. Looking one way culls
//     the chunks behind you, roughly halving the flora drawn.
//
// Trade-off vs the old single packed mesh: more draw calls (species-part × VISIBLE
// chunks instead of × 1), but far fewer triangles rasterised. On desktop the call
// budget is cheap; VR (double render) would want to watch it.
//
// removeChunk detaches the SHARED attributes before disposing a chunk geometry, so
// `geometry.dispose()` frees only the per-chunk instance buffers and never the
// shared shape other chunks still reference.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": classes from `three/webgpu`.

import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { FloraPart } from "./assets.ts";
import {
  type FloraLayerCompositor,
  type FloraMaterialHandle,
  createFloraMaterial,
} from "./material.ts";
import type { ScatterBlock } from "./scatter.ts";
import type { SpeciesDef } from "./species.ts";
import type { LifeUniforms } from "./uniforms.ts";

const MAT4 = 16;
const VEC3 = 3;

/** The shared, chunk-independent data for one species-part (its shape + material). */
interface PartSource {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly baseColor: THREE.Color;
  readonly foliage: boolean;
}

export class SpeciesInstances {
  readonly def: SpeciesDef;
  /** Parent of every live chunk mesh; added to the scene once by the caller. */
  readonly group: THREE.Group;

  private readonly sources: PartSource[] = [];
  private readonly materials: FloraMaterialHandle[] = [];
  /** Live chunk → its per-part InstancedMeshes (empty array for a plant-free chunk). */
  private readonly chunkMeshes = new Map<string, THREE.InstancedMesh[]>();
  private liveCount = 0;

  constructor(
    def: SpeciesDef,
    parts: readonly FloraPart[],
    _maxLiveChunks: number,
    u: KitUniforms,
    life: LifeUniforms,
    layers?: FloraLayerCompositor,
    foliageAtlas?: THREE.Texture,
    _reserveCap: number = def.perChunkCap,
  ) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.name = `flora:${def.id}`;

    // Two material variants at most: solid parts share one graph, foliage parts
    // (atlas-cutout cards) share the other. Built lazily.
    let solid: FloraMaterialHandle | undefined;
    let foliage: FloraMaterialHandle | undefined;
    const materialFor = (part: FloraPart): FloraMaterialHandle => {
      if (part.foliage && foliageAtlas) {
        foliage ??= createFloraMaterial(def, u, life, layers, foliageAtlas);
        return foliage;
      }
      solid ??= createFloraMaterial(def, u, life, layers);
      return solid;
    };

    for (const part of parts) {
      const handle = materialFor(part);
      if (!this.materials.includes(handle)) this.materials.push(handle);
      this.sources.push({
        geometry: part.geometry,
        material: handle.material,
        baseColor: part.baseColor,
        foliage: part.foliage,
      });
    }
  }

  /** Live (drawn) instance count across this species — for diagnostics. */
  get instanceCount(): number {
    return this.liveCount;
  }

  /** Rebuild the shared materials' colorNodes after a structural sense change. */
  rewire(): void {
    for (const handle of this.materials) handle.rewire();
  }

  /** Build one chunk's per-part meshes and add them to the group. */
  addChunk(key: string, block: ScatterBlock): void {
    if (this.chunkMeshes.has(key)) return;
    const used = block.count;
    if (used === 0) {
      this.chunkMeshes.set(key, []); // symmetric bookkeeping, no GPU work
      return;
    }

    // Chunk bounding sphere: bbox of the instance feet + the plant's own height,
    // in world space (the meshes sit at the origin; instances carry world matrices).
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxScale = 0;
    for (let i = 0; i < used; i++) {
      const m = i * MAT4;
      const x = block.matrices[m + 12] ?? 0;
      const y = block.matrices[m + 13] ?? 0;
      const z = block.matrices[m + 14] ?? 0;
      const sx = block.matrices[m] ?? 1;
      const sy = block.matrices[m + 1] ?? 0;
      const sz = block.matrices[m + 2] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (y < minY) minY = y;
      const s = Math.hypot(sx, sy, sz);
      if (s > maxScale) maxScale = s;
    }
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const top = this.def.targetHeight * (maxScale || 1);
    const cy = minY + top * 0.5;
    const sphereRadius =
      Math.hypot(maxX - cx, maxZ - cz, top * 0.5) + this.def.targetHeight * maxScale * 0.5;
    const centre = new THREE.Vector3(cx, cy, cz);

    const meshes: THREE.InstancedMesh[] = [];
    for (const source of this.sources) {
      // Plain geometry SHARING the part's shape attributes by reference; the
      // per-instance data below rides InstancedBufferAttributes (not an
      // InstancedBufferGeometry, whose Infinity instanceCount breaks the draw).
      const geometry = new THREE.BufferGeometry();
      geometry.index = source.geometry.index;
      const pos = source.geometry.getAttribute("position");
      const nrm = source.geometry.getAttribute("normal");
      const uvA = source.geometry.getAttribute("uv");
      if (pos) geometry.setAttribute("position", pos);
      if (nrm) geometry.setAttribute("normal", nrm);
      if (source.foliage && uvA) geometry.setAttribute("uv", uvA);

      // Per-chunk instance attributes, sized to the real count.
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(used * VEC3), VEC3);
      const thermalCenter = new THREE.InstancedBufferAttribute(new Float32Array(used * VEC3), VEC3);
      const thermalRadius = new THREE.InstancedBufferAttribute(new Float32Array(used), 1);
      const thermalVariation = new THREE.InstancedBufferAttribute(new Float32Array(used), 1);

      const tints = tint.array as Float32Array;
      const centers = thermalCenter.array as Float32Array;
      const radii = thermalRadius.array as Float32Array;
      const variations = thermalVariation.array as Float32Array;
      for (let i = 0; i < used; i++) {
        const j = i * VEC3;
        const m = i * MAT4;
        const jitter = block.jitter[i] ?? 1;
        tints[j] = source.baseColor.r * jitter;
        tints[j + 1] = source.baseColor.g * jitter;
        tints[j + 2] = source.baseColor.b * jitter;

        const x = block.matrices[m + 12] ?? 0;
        const y = block.matrices[m + 13] ?? 0;
        const z = block.matrices[m + 14] ?? 0;
        const sx = block.matrices[m] ?? 1;
        const sy = block.matrices[m + 1] ?? 0;
        const sz = block.matrices[m + 2] ?? 0;
        const scale = Math.hypot(sx, sy, sz);
        const height = this.def.targetHeight * scale;
        centers[j] = x;
        centers[j + 1] = y + height * 0.5;
        centers[j + 2] = z;
        radii[i] = height * 0.55;
        variations[i] = stableThermalVariation(x, z);
      }
      geometry.setAttribute("instanceTint", tint);
      geometry.setAttribute("instanceThermalCenter", thermalCenter);
      geometry.setAttribute("instanceThermalRadius", thermalRadius);
      geometry.setAttribute("instanceThermalVariation", thermalVariation);

      const mesh = new THREE.InstancedMesh(geometry, source.material, used);
      mesh.instanceMatrix.array.set(block.matrices.subarray(0, used * MAT4));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = used;
      // Frustum culling ON — the whole point: skip this chunk when it's off-screen.
      mesh.frustumCulled = true;
      mesh.boundingSphere = new THREE.Sphere(centre.clone(), sphereRadius);
      mesh.name = `${this.def.id}:${key}`;
      this.group.add(mesh);
      meshes.push(mesh);
    }

    this.chunkMeshes.set(key, meshes);
    this.liveCount += used;
  }

  /** Remove and free one chunk's meshes (keeps the shared shape intact). */
  removeChunk(key: string): void {
    const meshes = this.chunkMeshes.get(key);
    if (!meshes) return;
    for (const mesh of meshes) {
      this.freeChunkMesh(mesh);
      this.liveCount -= mesh.count;
    }
    this.chunkMeshes.delete(key);
  }

  /** Drop every chunk's meshes (e.g. a live density re-scatter, then re-addChunk). */
  clear(): void {
    for (const meshes of this.chunkMeshes.values()) {
      for (const mesh of meshes) this.freeChunkMesh(mesh);
    }
    this.chunkMeshes.clear();
    this.liveCount = 0;
  }

  /** Detach the shared shape, then dispose so only the per-chunk buffers are freed. */
  private freeChunkMesh(mesh: THREE.InstancedMesh): void {
    mesh.removeFromParent();
    const g = mesh.geometry;
    // Null the SHARED attributes so dispose() never frees another chunk's shape.
    g.index = null;
    g.deleteAttribute("position");
    g.deleteAttribute("normal");
    g.deleteAttribute("uv");
    g.dispose(); // frees the instanceTint/thermal* buffers only
    mesh.dispose(); // frees instanceMatrix
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    for (const source of this.sources) source.geometry.dispose();
    this.sources.length = 0;
    for (const handle of this.materials) handle.material.dispose();
    this.materials.length = 0;
  }
}

/** Deterministic per-plant variation from its fixed world position, in [-1, 1]. */
function stableThermalVariation(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}
