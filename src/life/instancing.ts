// ── Becoming Many — Species Instancing ─────────────────────────
//
// One global InstancedMesh per species-part, carved into `slotCount` equal blocks of
// `perChunkCap` instances. A streamed chunk owns one slot across every part of the
// species; freeing it zero-scales the block (degenerate triangles, discarded before
// the fragment stage) rather than moving anything.
//
// The parts of a species share a slot but NOT their buffers: each InstancedMesh owns
// its own `instanceMatrix` (three does), so we double-write the same matrices into
// each. Sharing one attribute object across meshes would double-free it on dispose.
// The per-instance tint differs per part anyway — it is the part's own material
// colour, scaled by the instance's jitter.
//
// `frustumCulled = false` is forced, not chosen: one mesh spans the whole streamed
// window, so its bounding sphere is never outside the frustum, and keeping it
// current as chunks stream would be pure churn. Cost is therefore view-independent,
// which is why `perChunkCap` is the only real lever (see species.ts).
//
// `mesh.count` is PINNED to capacity and never moved. three's `createInstanceMatrixNode`
// picks its instancing strategy from `mesh.count` — `count * 64 <= uniformBufferLimit`
// selects a uniform binding — but it then binds the WHOLE `instanceMatrix.array`. So a
// count below capacity can choose a uniform buffer that the full array immediately
// overflows ("Buffer binding range 94080 exceeds max_*_buffer_binding_size limit 65536",
// e.g. grass at 49 × 30 mat4s). Drawing only the occupied prefix would be a small vertex
// saving bought with that landmine; empty slots hold the all-zero matrix instead, which
// folds each triangle to a point and is discarded before the fragment stage.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": classes from `three/webgpu`.

import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { FloraPart } from "./assets.ts";
import { NEVER_AWOKEN, createFloraMaterial } from "./material.ts";
import type { ScatterBlock } from "./scatter.ts";
import type { SpeciesDef } from "./species.ts";
import type { LifeUniforms } from "./uniforms.ts";

const MAT4 = 16;
const VEC3 = 3;

interface PartMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly tint: THREE.InstancedBufferAttribute;
  readonly awaken: THREE.InstancedBufferAttribute;
  /** The part's material colour — the base every instance tint is jittered around. */
  readonly baseColor: THREE.Color;
}

export class SpeciesInstances {
  readonly def: SpeciesDef;
  private readonly parts: PartMesh[] = [];
  private readonly capacity: number;
  private readonly material: THREE.MeshStandardNodeMaterial;

  constructor(
    def: SpeciesDef,
    parts: readonly FloraPart[],
    slotCount: number,
    u: KitUniforms,
    life: LifeUniforms,
  ) {
    this.def = def;
    this.capacity = slotCount * def.perChunkCap;
    // One graph per species; every part draws with it and differs only by tint.
    this.material = createFloraMaterial(def, u, life);

    for (const part of parts) {
      const geometry = part.geometry;
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * VEC3), VEC3);
      const awaken = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
      awaken.array.fill(NEVER_AWOKEN);
      // `attribute("instanceTint")` picks up instance step-mode automatically because
      // these are InstancedBufferAttributes on the geometry.
      geometry.setAttribute("instanceTint", tint);
      geometry.setAttribute("instanceAwaken", awaken);

      const mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
      mesh.frustumCulled = false;
      // `count` stays at capacity for the mesh's whole life — see the header note.
      // three zero-fills `instanceMatrix`, so unclaimed slots are already invisible.
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      tint.setUsage(THREE.DynamicDrawUsage);
      awaken.setUsage(THREE.DynamicDrawUsage);

      this.parts.push({ mesh, tint, awaken, baseColor: part.baseColor });
    }
  }

  get meshes(): readonly THREE.InstancedMesh[] {
    return this.parts.map((p) => p.mesh);
  }

  /** Write one chunk's placed instances into `slot`, zero-scaling the block's tail. */
  writeBlock(slot: number, block: ScatterBlock): void {
    const cap = this.def.perChunkCap;
    const base = slot * cap;
    const used = block.count;

    for (const part of this.parts) {
      const m = part.mesh.instanceMatrix;
      const matrices = m.array;

      matrices.set(block.matrices.subarray(0, used * MAT4), base * MAT4);
      // Unused tail → the all-zero matrix, which folds every vertex onto the origin.
      // The resulting degenerate triangles are discarded before fragment shading.
      matrices.fill(0, (base + used) * MAT4, (base + cap) * MAT4);
      m.addUpdateRange(base * MAT4, cap * MAT4); // element (float) offsets, not instances
      m.needsUpdate = true;

      const tints = part.tint.array;
      for (let i = 0; i < used; i++) {
        const j = (base + i) * VEC3;
        const jitter = block.jitter[i] ?? 1;
        tints[j] = part.baseColor.r * jitter;
        tints[j + 1] = part.baseColor.g * jitter;
        tints[j + 2] = part.baseColor.b * jitter;
      }
      part.tint.addUpdateRange(base * VEC3, cap * VEC3);
      part.tint.needsUpdate = true;

      part.awaken.array.fill(NEVER_AWOKEN, base, base + cap);
      part.awaken.addUpdateRange(base, cap);
      part.awaken.needsUpdate = true;
    }
  }

  /** Zero-scale a block so its instances vanish; the slot may then be reclaimed. */
  clearBlock(slot: number): void {
    const cap = this.def.perChunkCap;
    const base = slot * cap;
    for (const part of this.parts) {
      const m = part.mesh.instanceMatrix;
      m.array.fill(0, base * MAT4, (base + cap) * MAT4);
      m.addUpdateRange(base * MAT4, cap * MAT4);
      m.needsUpdate = true;
    }
  }

  /** Stamp the awakening time across a block — the proximity response. */
  awakenBlock(slot: number, at: number): void {
    const cap = this.def.perChunkCap;
    const base = slot * cap;
    for (const part of this.parts) {
      part.awaken.array.fill(at, base, base + cap);
      part.awaken.addUpdateRange(base, cap);
      part.awaken.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
      part.mesh.geometry.dispose();
    }
    this.parts.length = 0;
    this.material.dispose();
  }
}
