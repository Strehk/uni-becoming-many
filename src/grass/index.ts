// ── Becoming Many — GPU Grass ──────────────────────────────────
//
// createGrass(opts) → Grass: a camera-centred field of ~590 k compute-driven bezier
// blades that streams with the world and grows only on grass-fitting biomes.
//
// Wiring mirrors `src/life/`:
//   - terrain calls `onChunkBuilt`/`onChunkDisposed` → the fields cache (+ mask texture)
//   - main.ts calls `update(dt)` each frame → snap, repaint the field texture, dispatch
//     the reset + main compute, and gate everything on a sense being active (the world is
//     invisible in the void, so no grass — and no compute cost — until a sense reveals it).
//
// The grass is a `SenseSurface` like terrain/flora: its material runs through the shared
// sense compositor + void look, so senses restyle grass, ground and plants together.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import * as THREE from "three/webgpu";
import { signals } from "../signals/index.ts";
import type {
  ChunkBuiltInfo,
  ChunkCell,
  KitUniforms,
  TerrainLayerCompositor,
} from "../terrain/index.ts";
import {
  BLADE_SPACING,
  BLADE_STEPS_PER_CELL,
  TOTAL_BLADES,
  createGrassUniforms,
} from "./config.ts";
import { GrassFieldTexture } from "./field-texture.ts";
import { FieldsCache } from "./fields-cache.ts";
import { createGrassCompute } from "./grass-compute.ts";
import { createBladeGeometry, createGrassData, createLODBuffers } from "./grass-geometry.ts";
import { type GrassMaterialHandle, createGrassMaterial } from "./grass-material.ts";

/** Wind strength eased by authored unrest: [WIND_BASE, WIND_BASE+WIND_GAIN]. */
const WIND_BASE = 0.35;
const WIND_GAIN = 0.5;

export interface CreateGrassOptions {
  scene: THREE.Scene;
  /** The WebGPU renderer (dispatches the compute passes). */
  renderer: THREE.WebGPURenderer;
  /** The render camera (world position + VP drive culling/snapping). */
  camera: THREE.Camera;
  /** Live sense uniforms — the same set terrain + flora wear. */
  uniforms: KitUniforms;
  /** The shader-sense compositor (same object terrain/flora get). */
  layers?: TerrainLayerCompositor;
  /** World ground height at (x,z), or null over not-yet-loaded chunks. */
  groundHeightAt: (x: number, z: number) => number | null;
}

export interface Grass {
  readonly group: THREE.Group;
  /** Hand to `createTerrainWorld({ onChunkBuilt })`. */
  onChunkBuilt(info: ChunkBuiltInfo): void;
  /** Hand to `createTerrainWorld({ onChunkDisposed })`. */
  onChunkDisposed(cell: ChunkCell): void;
  /** Advance one frame (after `world.update`). Skips all GPU work in the void. */
  update(dt: number): void;
  dispose(): void;
}

export function createGrass(opts: CreateGrassOptions): Grass {
  const { scene, renderer, camera } = opts;

  const group = new THREE.Group();
  scene.add(group);

  const uniforms = createGrassUniforms();
  const fieldTex = new GrassFieldTexture();
  uniforms.compute.uFieldTexSize.value = fieldTex.size;

  const grassData = createGrassData();
  const lodBuffers = createLODBuffers();
  const { compute, reset } = createGrassCompute(
    grassData,
    lodBuffers,
    uniforms.compute,
    uniforms.shared,
    fieldTex.texture,
    fieldTex.res,
  );

  // One indirect-drawn mesh + material per LOD tier (each reads its own visible-index buf).
  const meshes: THREE.Mesh[] = [];
  const materials: GrassMaterialHandle[] = [];
  for (const lod of lodBuffers) {
    const geometry = createBladeGeometry(lod.segments);
    geometry.setIndirect(lod.drawBuffer);
    const handle = createGrassMaterial(
      grassData,
      lod.indices,
      uniforms.material,
      uniforms.shared,
      opts.uniforms,
      opts.layers,
    );
    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.count = TOTAL_BLADES; // upper bound; the atomic counter sets the real draw count
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    meshes.push(mesh);
    materials.push(handle);
  }

  // Structural sense changes (blend mode / order) rebuild every LOD's colorNode.
  const detachLayers = opts.layers?.onStructureChange(() => {
    for (const m of materials) m.rewire();
  });

  // Fields cache, created lazily from the first chunk's size (mirrors ChunkHeightCache).
  let fieldsCache: FieldsCache | null = null;
  const maskAt = (x: number, z: number): number => fieldsCache?.grassMaskAt(x, z) ?? 0;

  const gridCellSize = BLADE_SPACING * BLADE_STEPS_PER_CELL;
  const camPos = new THREE.Vector3();

  return {
    group,

    onChunkBuilt(info: ChunkBuiltInfo): void {
      if (!fieldsCache) fieldsCache = new FieldsCache(info.chunkSize);
      fieldsCache.add(info.gridX, info.gridZ, info.fields);
      fieldTex.invalidate(); // new ground → repaint next frame
    },

    onChunkDisposed(cell: ChunkCell): void {
      fieldsCache?.remove(cell.gridX, cell.gridZ);
      fieldTex.invalidate();
    },

    update(_dt: number): void {
      // Void gate: no sense active ⇒ hide + skip ALL GPU work (compute + draw).
      const revealed = signals.activeSense.peek() !== "none";
      group.visible = revealed;
      if (!revealed) return;

      camera.updateMatrixWorld();
      camera.getWorldPosition(camPos);

      // Grid-snap the patch to the camera (blade-spacing grid → world-stable seed).
      const cellX = Math.floor(camPos.x / gridCellSize);
      const cellZ = Math.floor(camPos.z / gridCellSize);
      const snappedX = cellX * gridCellSize;
      const snappedZ = cellZ * gridCellSize;
      group.position.set(snappedX, 0, snappedZ);
      group.updateMatrixWorld(true);
      uniforms.compute.uGroupOffset.value.set(snappedX, 0, snappedZ);
      uniforms.material.uGroupOffset.value.copy(uniforms.compute.uGroupOffset.value);
      uniforms.compute.uGridIndex.value.set(
        cellX * BLADE_STEPS_PER_CELL,
        cellZ * BLADE_STEPS_PER_CELL,
      );

      // Repaint + recentre the field texture on the coarse snap (a few times/sec).
      if (fieldTex.update(camPos.x, camPos.z, opts.groundHeightAt, maskAt)) {
        uniforms.compute.uFieldTexOrigin.value.copy(fieldTex.origin);
        uniforms.compute.uFieldTexSize.value = fieldTex.size;
      }

      // Per-frame compute inputs.
      uniforms.shared.uTime.value = signals.time.peek();
      uniforms.compute.uWindStrength.value = WIND_BASE + signals.unrest.peek() * WIND_GAIN;
      uniforms.compute.uCameraPosition.value.copy(camPos);
      uniforms.compute.uViewProjectionMatrix.value.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );

      // Reset the draw counters, then place + route this frame's blades.
      renderer.compute(reset);
      renderer.compute(compute);
    },

    dispose(): void {
      detachLayers?.();
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const m of materials) m.material.dispose();
      fieldTex.dispose();
      fieldsCache?.clear();
      group.removeFromParent();
    },
  };
}
