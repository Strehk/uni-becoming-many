// ── Becoming Many — Grass Geometry & Buffers ───────────────────
//
// The blade mesh + the GPU-resident buffers the compute writes and the material reads.
// Ported from momentchan/false-earth `components/grass/core/grassGeometry.ts` +
// the LOD-buffer setup from its `useGrassCompute` hook.
//
// One blade is a `PlaneGeometry(1,1,1,segments)` shifted so its base sits at y=0; the
// vertex shader reshapes it into a bezier blade. Each LOD tier is one such geometry at
// a different segment count, drawn indirectly — the compute's atomic counter decides
// how many instances of each tier actually draw.

import { instancedArray, storage } from "three/tsl";
import * as THREE from "three/webgpu";
import { LOD_SEGMENTS_CONFIG, TOTAL_BLADES, drawIndirectStructure } from "./config.ts";

/** One LOD's live compute + draw resources. */
export interface LODBuffer {
  segments: number;
  minDistance: number;
  maxDistance: number;
  /** Visible blade indices for this LOD (written by the compute cull). */
  indices: ReturnType<typeof createVisibleIndicesBuffer>;
  drawBuffer: THREE.IndirectStorageBufferAttribute;
  drawStorage: ReturnType<typeof storage>;
  vertexCount: number;
}

/** A subdivided quad, base at y=0, tip at y=1 — the vertex shader curves it. */
export function createBladeGeometry(segments: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, segments);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** The per-blade data as ONE vec4 storage buffer, 4 vec4 per blade (blade b's data_k is
 *  element `b*4 + k`; layout in config.ts), zero-filled. A single buffer (not four) keeps
 *  the compute under WebGPU's 8-storage-buffers-per-stage limit: 1 data + 3 LOD index +
 *  3 LOD draw = 7. Use `bladeSlot(index)` to get the base element. */
export function createGrassData() {
  return instancedArray(new Float32Array(TOTAL_BLADES * 4 * 4), "vec4");
}

/** The single-buffer grass data handle. */
export type GrassData = ReturnType<typeof createGrassData>;

/** Per-LOD visible-blade index list (compute writes real blade indices here). */
export function createVisibleIndicesBuffer() {
  return instancedArray(new Uint32Array(TOTAL_BLADES), "uint");
}

/** Build one LOD buffer per tier: a visible-index list + an indirect draw buffer. */
export function createLODBuffers(): LODBuffer[] {
  return LOD_SEGMENTS_CONFIG.map((cfg) => {
    const geometry = createBladeGeometry(cfg.segments);
    const vertexCount = geometry.index?.count ?? 0; // PlaneGeometry is always indexed
    geometry.dispose();

    const drawBuffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array(5), 5);
    const drawStorage = storage(drawBuffer, drawIndirectStructure, 1);

    return {
      segments: cfg.segments,
      minDistance: cfg.minDistance,
      maxDistance: cfg.maxDistance,
      indices: createVisibleIndicesBuffer(),
      drawBuffer,
      drawStorage,
      vertexCount,
    };
  });
}
