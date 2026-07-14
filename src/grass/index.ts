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
import { cameraPos, cameraViewProjection } from "../render/camera-pos.ts";
import { AIR_ONLY_SENSES, SENSE_ORDER } from "../senses/ids.ts";
import { signals } from "../signals/index.ts";
import type {
  ChunkBuiltInfo,
  ChunkCell,
  KitUniforms,
  TerrainLayerCompositor,
} from "../terrain/index.ts";
import { setGrassBiomeConfig } from "./biomes.ts";
import {
  BLADE_SPACING,
  BLADE_STEPS_PER_CELL,
  GRASS_AREA_SIZE,
  TOTAL_BLADES,
  VR_KEEP_FRACTION,
  VR_RENDER_RADIUS,
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

/** The authored blade-height range (matches createGrassUniforms' defaults) —
 *  the flora config's `grassHeight` multiplies these. */
const BASE_BLADE_HEIGHT_MIN = 0.4;
const BASE_BLADE_HEIGHT_MAX = 0.85;

export interface CreateGrassOptions {
  scene: THREE.Scene;
  /** The WebGPU renderer (dispatches the compute passes; `.xr.isPresenting` picks the
   *  VR density profile). Eye position + cull frustum come from `camera-pos.ts`. */
  renderer: THREE.WebGPURenderer;
  /** Live sense uniforms — the same set terrain + flora wear. */
  uniforms: KitUniforms;
  /** The shader-sense compositor (same object terrain/flora get). */
  layers?: TerrainLayerCompositor;
  /** World ground height at (x,z), or null over not-yet-loaded chunks. */
  groundHeightAt: (x: number, z: number) => number | null;
}

/** The grass slice of the flora config (see src/flora-fauna/config.ts). */
export interface GrassTuning {
  /** Blade height multiplier (scales the authored min/max). */
  readonly grassHeight: number;
  /** Per-biome density multipliers over the authored affinities. */
  readonly grassMeadow: number;
  readonly grassForest: number;
  readonly grassTaiga: number;
  readonly grassHills: number;
}

export interface Grass {
  readonly group: THREE.Group;
  /** Hand to `createTerrainWorld({ onChunkBuilt })`. */
  onChunkBuilt(info: ChunkBuiltInfo): void;
  /** Hand to `createTerrainWorld({ onChunkDisposed })`. */
  onChunkDisposed(cell: ChunkCell): void;
  /** Apply the flora config's grass knobs: blade height (live uniforms) and
   *  per-biome density (affinity table + field-texture repaint). */
  applyConfig(tuning: GrassTuning): void;
  /** Advance one frame (after `world.update`). Skips all GPU work in the void. */
  update(dt: number): void;
  dispose(): void;
}

export function createGrass(opts: CreateGrassOptions): Grass {
  const { scene, renderer } = opts;

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

    applyConfig(tuning: GrassTuning): void {
      // Blade height: live uniforms the per-frame compute reads.
      const h = Math.max(0.05, tuning.grassHeight);
      uniforms.compute.uBladeHeightMin.value = BASE_BLADE_HEIGHT_MIN * h;
      uniforms.compute.uBladeHeightMax.value = BASE_BLADE_HEIGHT_MAX * h;
      // Per-biome density: rewrite the affinity table + repaint the mask texture.
      setGrassBiomeConfig({
        meadow: tuning.grassMeadow,
        forest: tuning.grassForest,
        taiga: tuning.grassTaiga,
        hills: tuning.grassHills,
      });
      fieldTex.invalidate();
    },

    update(_dt: number): void {
      // Void gate: no SURFACE-revealing sense active ⇒ hide + skip ALL GPU work
      // (compute + draw). Air-only senses (duft) never reveal the grass.
      const revealed = SENSE_ORDER.some(
        (id) => !AIR_ONLY_SENSES.has(id) && signals.sense[id].peek() > 0,
      );
      group.visible = revealed;
      if (!revealed) return;

      // Eye position + cull frustum come from the shared observer (`camera-pos.ts`),
      // NOT the mono app camera: under the WebGPU/WebXR path the mono camera does not
      // track the head, so centring the patch and culling against it would drop nearly
      // every blade in VR (only the 3 m `isClose` bypass would survive → no grass).
      // `syncCameraPos` publishes the presenting camera's pose once per frame (main.ts).
      camPos.copy(cameraPos.value);

      // VR density reduction: stereo pays the blade cost twice, so while presenting we
      // draw a smaller circle and thin the broad field. The near-camera bypass keeps you
      // standing in full-density grass regardless (see config.ts). This is the only bit of
      // grass that still needs the VR flag — a density choice, not eye-position math.
      const presenting = renderer.xr.isPresenting;
      uniforms.compute.uRenderRadius.value = presenting ? VR_RENDER_RADIUS : GRASS_AREA_SIZE * 0.5;
      uniforms.compute.uKeepFraction.value = presenting ? VR_KEEP_FRACTION : 1;

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
      uniforms.compute.uViewProjectionMatrix.value.copy(cameraViewProjection);

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
