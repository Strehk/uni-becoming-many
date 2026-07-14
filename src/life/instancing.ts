// ── Becoming Many — Species Instancing ─────────────────────────
//
// One global InstancedMesh per species-part, backed by a PACKED instance buffer:
// live instances sit contiguously in [0, liveCount), and `mesh.count` is exactly
// liveCount. Nothing phantom is ever drawn. A chunk that streams in appends its
// placed instances to the tail; a chunk that streams out is removed by shifting the
// tail down over its hole (a native copyWithin) and shrinking the count.
//
// Why packed and not fixed per-chunk slots: with slots, `count` had to cover the
// whole capacity (49 blocks × cap) so the tail's empty slots still ran the vertex
// shader as degenerate triangles — ~30 k phantom instances for ~10 k real ones. The
// draw cost is `count`, so the only way to stop paying for absent plants is to keep
// `count` at the real total.
//
// The instance matrix is a StorageInstancedBufferAttribute, not a plain
// InstancedBufferAttribute. three picks its matrix-instancing strategy from
// `mesh.count`: a small count selects a UNIFORM binding, which it then sizes to the
// WHOLE array and blows the 64 KB uniform-buffer limit as soon as capacity is large
// (grass: 49 × 320 mat4). A storage attribute takes the count-independent storage
// path (no such limit), which is the whole reason `count` can float freely here.
// This is also the GPU-resident buffer AGENT.md's "Rendering BufferArray" endorses.
//
// `frustumCulled = false` is forced: one mesh spans the whole streamed window, so
// its bounds never leave the frustum and maintaining them would be churn. Culling is
// coarse (whole flora set) — the per-chunk streaming radius is the real cull.
//
// Uploads happen only on the discrete stream events that touch a buffer, not per
// frame; a still player uploads nothing. Parts of a species share the packing
// (identical transforms) but keep their own buffers, written together.
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

interface PartMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly matrix: THREE.StorageInstancedBufferAttribute;
  readonly tint: THREE.InstancedBufferAttribute;
  readonly thermalCenter: THREE.InstancedBufferAttribute;
  readonly thermalRadius: THREE.InstancedBufferAttribute;
  readonly thermalVariation: THREE.InstancedBufferAttribute;
  /** The part's material colour — the base every instance tint is jittered around. */
  readonly baseColor: THREE.Color;
}

/** Where one live chunk's instances sit in the packed buffer. */
interface Block {
  offset: number;
  length: number;
}

export class SpeciesInstances {
  readonly def: SpeciesDef;
  private readonly parts: PartMesh[] = [];
  private readonly capacity: number;
  private readonly materials: FloraMaterialHandle[] = [];

  /** Packing state — shared by every part (their transforms are identical). */
  private liveCount = 0;
  private readonly order: string[] = [];
  private readonly blocks = new Map<string, Block>();

  constructor(
    def: SpeciesDef,
    parts: readonly FloraPart[],
    maxLiveChunks: number,
    u: KitUniforms,
    life: LifeUniforms,
    layers?: FloraLayerCompositor,
    foliageAtlas?: THREE.Texture,
    /** Per-chunk cap the buffers are SIZED for — the density ceiling. Defaults to
     *  the base cap; the flora config passes a larger reserve so live density
     *  edits re-scatter into the same buffers without reallocation. */
    reserveCap: number = def.perChunkCap,
  ) {
    this.def = def;
    // Worst case: every live chunk fills its reserve cap at once.
    this.capacity = maxLiveChunks * reserveCap;

    // Two material variants at most: solid parts share one graph, foliage parts
    // (atlas-cutout cards, see material.ts) share the other. Built lazily — a
    // rock never pays for the foliage material and vice versa.
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
      const geometry = part.geometry;
      // Storage attribute for the matrix → count-independent instancing strategy.
      const matrix = new THREE.StorageInstancedBufferAttribute(
        new Float32Array(this.capacity * MAT4),
        MAT4,
      );
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * VEC3), VEC3);
      const thermalCenter = new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity * VEC3),
        VEC3,
      );
      const thermalRadius = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
      const thermalVariation = new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity),
        1,
      );
      geometry.setAttribute("instanceTint", tint);
      geometry.setAttribute("instanceThermalCenter", thermalCenter);
      geometry.setAttribute("instanceThermalRadius", thermalRadius);
      geometry.setAttribute("instanceThermalVariation", thermalVariation);

      const handle = materialFor(part);
      if (!this.materials.includes(handle)) this.materials.push(handle);
      const mesh = new THREE.InstancedMesh(geometry, handle.material, this.capacity);
      mesh.frustumCulled = false;
      mesh.instanceMatrix = matrix; // replace the default plain attribute
      mesh.count = 0; // packed total; grows as chunks stream in
      matrix.setUsage(THREE.DynamicDrawUsage);
      tint.setUsage(THREE.DynamicDrawUsage);
      thermalCenter.setUsage(THREE.DynamicDrawUsage);
      thermalRadius.setUsage(THREE.DynamicDrawUsage);
      thermalVariation.setUsage(THREE.DynamicDrawUsage);

      this.parts.push({
        mesh,
        matrix,
        tint,
        thermalCenter,
        thermalRadius,
        thermalVariation,
        baseColor: part.baseColor,
      });
    }
  }

  get meshes(): readonly THREE.InstancedMesh[] {
    return this.parts.map((p) => p.mesh);
  }

  /** Live (drawn) instance count across this species — for diagnostics. */
  get instanceCount(): number {
    return this.liveCount;
  }

  /** Rebuild the shared materials' colorNodes after a structural sense change. */
  rewire(): void {
    for (const handle of this.materials) handle.rewire();
  }

  /** Append one chunk's placed instances to the packed tail. */
  addChunk(key: string, block: ScatterBlock): void {
    if (this.blocks.has(key)) return;
    const used = block.count;
    if (used === 0) {
      // Track an empty block so removeChunk stays symmetric, but touch no buffers.
      this.blocks.set(key, { offset: this.liveCount, length: 0 });
      this.order.push(key);
      return;
    }
    if (this.liveCount + used > this.capacity) {
      console.warn(`[life] ${this.def.id}: instance buffer full, dropping chunk ${key}`);
      return;
    }

    const offset = this.liveCount;
    for (const part of this.parts) {
      part.matrix.array.set(block.matrices.subarray(0, used * MAT4), offset * MAT4);

      const tints = part.tint.array;
      const centers = part.thermalCenter.array;
      const radii = part.thermalRadius.array;
      const variations = part.thermalVariation.array;
      for (let i = 0; i < used; i++) {
        const j = (offset + i) * VEC3;
        const matrixOffset = i * MAT4;
        const jitter = block.jitter[i] ?? 1;
        tints[j] = part.baseColor.r * jitter;
        tints[j + 1] = part.baseColor.g * jitter;
        tints[j + 2] = part.baseColor.b * jitter;

        const x = block.matrices[matrixOffset + 12] ?? 0;
        const y = block.matrices[matrixOffset + 13] ?? 0;
        const z = block.matrices[matrixOffset + 14] ?? 0;
        const sx = block.matrices[matrixOffset] ?? 1;
        const sy = block.matrices[matrixOffset + 1] ?? 0;
        const sz = block.matrices[matrixOffset + 2] ?? 0;
        const scale = Math.hypot(sx, sy, sz);
        const height = this.def.targetHeight * scale;
        centers[j] = x;
        centers[j + 1] = y + height * 0.5;
        centers[j + 2] = z;
        radii[offset + i] = height * 0.55;
        variations[offset + i] = stableThermalVariation(x, z);
      }

      this.markDirty(part);
      part.mesh.count = offset + used;
    }

    this.blocks.set(key, { offset, length: used });
    this.order.push(key);
    this.liveCount = offset + used;
  }

  /** Remove a chunk's instances by shifting the packed tail down over its hole. */
  removeChunk(key: string): void {
    const block = this.blocks.get(key);
    if (!block) return;
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.blocks.delete(key);

    if (block.length > 0) {
      const tailStart = block.offset + block.length;
      const moved = this.liveCount - tailStart;
      if (moved > 0) {
        for (const part of this.parts) {
          part.matrix.array.copyWithin(
            block.offset * MAT4,
            tailStart * MAT4,
            this.liveCount * MAT4,
          );
          part.tint.array.copyWithin(block.offset * VEC3, tailStart * VEC3, this.liveCount * VEC3);
          part.thermalCenter.array.copyWithin(
            block.offset * VEC3,
            tailStart * VEC3,
            this.liveCount * VEC3,
          );
          part.thermalRadius.array.copyWithin(block.offset, tailStart, this.liveCount);
          part.thermalVariation.array.copyWithin(block.offset, tailStart, this.liveCount);
        }
      }
      this.liveCount -= block.length;

      // The tail moved, so every block after the hole shifted down. Recompute
      // offsets by walking the surviving order (≤ 49 entries — trivial).
      let off = 0;
      for (const k of this.order) {
        const b = this.blocks.get(k);
        if (b) {
          b.offset = off;
          off += b.length;
        }
      }
      for (const part of this.parts) {
        this.markDirty(part);
        part.mesh.count = this.liveCount;
      }
    }
  }

  /** Drop every chunk's instances (packing state only — buffers keep their
   *  capacity). Used by a live density re-scatter: clear, then re-`addChunk` all
   *  cached chunks with new caps. */
  clear(): void {
    this.blocks.clear();
    this.order.length = 0;
    this.liveCount = 0;
    for (const part of this.parts) {
      this.markDirty(part);
      part.mesh.count = 0;
    }
  }

  private markDirty(part: PartMesh): void {
    part.matrix.needsUpdate = true;
    part.tint.needsUpdate = true;
    part.thermalCenter.needsUpdate = true;
    part.thermalRadius.needsUpdate = true;
    part.thermalVariation.needsUpdate = true;
  }

  dispose(): void {
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
      part.mesh.geometry.dispose();
    }
    this.parts.length = 0;
    this.blocks.clear();
    this.order.length = 0;
    this.liveCount = 0;
    for (const handle of this.materials) handle.material.dispose();
    this.materials.length = 0;
  }
}

/** Deterministic per-plant variation from its fixed world position, in [-1, 1]. */
function stableThermalVariation(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}
