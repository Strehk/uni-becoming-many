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
  private readonly material: FloraMaterialHandle;

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
  ) {
    this.def = def;
    // Worst case: every live chunk fills its cap at once.
    this.capacity = maxLiveChunks * def.perChunkCap;
    this.material = createFloraMaterial(def, u, life, layers);

    for (const part of parts) {
      const geometry = part.geometry;
      // Storage attribute for the matrix → count-independent instancing strategy.
      const matrix = new THREE.StorageInstancedBufferAttribute(
        new Float32Array(this.capacity * MAT4),
        MAT4,
      );
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * VEC3), VEC3);
      geometry.setAttribute("instanceTint", tint);

      const mesh = new THREE.InstancedMesh(geometry, this.material.material, this.capacity);
      mesh.frustumCulled = false;
      mesh.instanceMatrix = matrix; // replace the default plain attribute
      mesh.count = 0; // packed total; grows as chunks stream in
      matrix.setUsage(THREE.DynamicDrawUsage);
      tint.setUsage(THREE.DynamicDrawUsage);

      this.parts.push({ mesh, matrix, tint, baseColor: part.baseColor });
    }
  }

  get meshes(): readonly THREE.InstancedMesh[] {
    return this.parts.map((p) => p.mesh);
  }

  /** Live (drawn) instance count across this species — for diagnostics. */
  get instanceCount(): number {
    return this.liveCount;
  }

  /** Rebuild the shared material's colorNode after a structural sense change. */
  rewire(): void {
    this.material.rewire();
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
      for (let i = 0; i < used; i++) {
        const j = (offset + i) * VEC3;
        const jitter = block.jitter[i] ?? 1;
        tints[j] = part.baseColor.r * jitter;
        tints[j + 1] = part.baseColor.g * jitter;
        tints[j + 2] = part.baseColor.b * jitter;
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

  private markDirty(part: PartMesh): void {
    part.matrix.needsUpdate = true;
    part.tint.needsUpdate = true;
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
    this.material.material.dispose();
  }
}
