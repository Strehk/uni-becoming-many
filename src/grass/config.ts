// ── Becoming Many — GPU Grass Config ───────────────────────────
//
// Constants + packed-buffer layouts + the live tuning uniforms for the compute-driven
// grass. Ported from momentchan/false-earth `components/grass/core/config.ts`, trimmed
// to what this port uses (no character-push / cosmic-wave paths) and re-typed for the
// repo's strict-TS + `noExplicitAny` gate.
//
// A single camera-centred patch of `BLADES_PER_AXIS²` blades spread over a
// `GRASS_AREA_SIZE` square; only the blades inside the `GRASS_AREA_SIZE/2` radius circle
// (and the view frustum, and a fitting biome) are ever drawn. `BLADES_PER_AXIS` is a
// compile-time constant — it sizes the storage buffers and the compute dispatch, so it
// cannot become a runtime uniform. Everything shape/wind/colour-ish IS a live uniform.
//
// Balanced density (see the plan): 768² ≈ 590 k blades over a 96 m square (48 m render
// radius) ≈ 64 blades/m² — lush near the camera, fading out well inside the fog.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL.

import { struct, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

// The per-blade data is carried in FOUR vec4 storage buffers (data0..data3), not a
// packed `struct` buffer: `@types/three`'s `instancedArray` has no struct overload
// (it works at runtime but won't typecheck), and the repo's own GPU code (duft) uses
// plain vec4 buffers for exactly this reason. Layout:
//   data0 = Position(xyz) + Type(w)
//   data1 = Width(x), Height(y), Bend(z), WindStrength(w)
//   data2 = RotSin(x), RotCos(y), ClumpSeed(z), BladeSeed(w)
//   data3 = TerrainNormal(xz) + spare(zw)   (vertex reconstructs tn.y)

/** Blades per grid axis. Compile-time — sizes buffers + the compute dispatch. */
export const BLADES_PER_AXIS = 768;
/** Total blade instances (worst-case draw count / buffer capacity). */
export const TOTAL_BLADES = BLADES_PER_AXIS * BLADES_PER_AXIS;
/** World size of the square the blades tile (render circle radius = half this). */
export const GRASS_AREA_SIZE = 96;

// ── VR density reduction ───────────────────────────────────────
// `BLADES_PER_AXIS` is compile-time (it sizes the buffers + the compute dispatch), so
// VR can't shrink the grid — it dials down the *drawn* set at runtime instead, via two
// compute uniforms driven by `renderer.xr.isPresenting` (see index.ts). Stereo rendering
// pays the blade cost twice, so Quest wants far fewer blades on screen.
/** VR draw-circle radius (m). Smaller than the 48 m desktop radius so far fewer blades
 *  draw per eye; the distance fog + tiny far LOD blades soften the closer edge. */
export const VR_RENDER_RADIUS = 34;
/** VR keep-fraction: world-stable hash thinning of the broad field (blades/m² cut). The
 *  near-camera 3 m `isClose` bypass stays full density regardless, so you always stand in
 *  lush grass. 1 = no thinning (desktop default). */
export const VR_KEEP_FRACTION = 0.6;
/** World units between adjacent blades before jitter. */
export const BLADE_SPACING = GRASS_AREA_SIZE / BLADES_PER_AXIS;
/** Blade spacings per grid-snap step. gridCellSize = BLADE_SPACING * this. Kept at 1 so
 *  the group snaps every blade-spacing → the PCG seed stays world-stable (no swimming). */
export const BLADE_STEPS_PER_CELL = 1;

/** LOD tiers: near blades get many segments (smooth curve), far ones a couple. */
export const LOD_SEGMENTS_CONFIG = [
  { segments: 15, minDistance: 0, maxDistance: 6 },
  { segments: 5, minDistance: 6, maxDistance: 22 },
  { segments: 2, minDistance: 22, maxDistance: Number.POSITIVE_INFINITY },
] as const;

// Indirect draw buffer (WebGPU drawIndexedIndirect layout). The compute atomically
// increments `instanceCount`; the GPU reads all five words to dispatch the draw.
export const drawIndirectStructure = struct({
  vertexCount: "uint", // index count for our indexed blade geometry
  instanceCount: { type: "uint", atomic: true }, // visible blades this frame
  firstVertex: "uint",
  firstInstance: "uint",
  offset: "uint", // baseVertex
});

/** The live tuning uniforms, split into the set the compute reads and the set the
 *  material reads (some are shared). Mutate `.value` at runtime to tune live. */
export function createGrassUniforms() {
  return {
    // Read by BOTH the compute (per-blade facing) and the material (vertex sway).
    shared: {
      /** Virtual-clock time (driven from signals.time, so pause freezes the wind). */
      uTime: uniform(0),
      /** World wind direction (xz). */
      uWindDir: uniform(new THREE.Vector2(1, 0.2)),
    },
    compute: {
      // Shape (per-clump base ranges)
      uBladeHeightMin: uniform(0.4),
      uBladeHeightMax: uniform(0.85),
      uBladeWidthMin: uniform(0.015),
      uBladeWidthMax: uniform(0.05),
      uBendAmountMin: uniform(0.2),
      uBendAmountMax: uniform(0.6),
      uBladeRandomness: uniform(new THREE.Vector3(0.3, 0.3, 0.2)),

      // Clumping (Voronoi)
      uClumpSize: uniform(1.2),
      uClumpBlendSmoothness: uniform(0.4),
      uCenterYaw: uniform(0.15),
      uBladeYaw: uniform(1.2),
      uClumpYaw: uniform(2.2),

      // Wind (drives per-blade facing in the compute)
      uWindScale: uniform(0.12),
      uWindSpeed: uniform(0.4),
      uWindStrength: uniform(0.5),
      uWindFacing: uniform(0.6),

      // Culling / LOD
      /** Draw-circle radius (m). Half of GRASS_AREA_SIZE on desktop; VR shrinks it live
       *  (VR_RENDER_RADIUS) to cut the drawn blade count. */
      uRenderRadius: uniform(GRASS_AREA_SIZE * 0.5),
      /** Fraction of the broad field kept (world-stable hash thinning). 1 on desktop; VR
       *  lowers it (VR_KEEP_FRACTION). The 3 m near bypass ignores this. */
      uKeepFraction: uniform(1),
      uLODNoiseScale: uniform(0.1),
      /** Blades on ground with grass-mask below this are never drawn. Low: grassland
       *  vegetation × affinity × slopeGate lands ~0.1–0.4, so keep the floor small. */
      uMaskThreshold: uniform(0.05),

      // Per-frame driven
      uViewProjectionMatrix: uniform(new THREE.Matrix4()),
      uCameraPosition: uniform(new THREE.Vector3()),
      uGroupOffset: uniform(new THREE.Vector3()),
      uGridIndex: uniform(new THREE.Vector2(0, 0)),

      // Field texture mapping (worldXZ → uv): origin = min corner, size = coverage (m)
      uFieldTexOrigin: uniform(new THREE.Vector2(0, 0)),
      uFieldTexSize: uniform(1),
    },
    material: {
      // Vertex sway (wind flutter at the tip)
      uWindSwayFreqMin: uniform(0.4),
      uWindSwayFreqMax: uniform(1.5),
      uWindSwayStrength: uniform(0.012),
      uWindDistanceStart: uniform(40),
      uWindDistanceEnd: uniform(90),

      // Blade width shaping (rim + midrib normal)
      uMidSoft: uniform(0.25),
      uRimPos: uniform(0.42),
      uRimSoft: uniform(0.03),
      uBaseWidth: uniform(0.35),
      uTipThin: uniform(0.9),
      uThicknessStrength: uniform(0.1),

      // Colour (base→tip gradient + per-clump / per-blade tint)
      uBaseColor: uniform(new THREE.Color(0x2f5d34)),
      uTipColor: uniform(new THREE.Color(0x6f9d4a)),
      uBladeSeedRange: uniform(new THREE.Vector2(0.95, 1.03)),
      uClumpSeedRange: uniform(new THREE.Vector2(0.9, 1.1)),
      uAOPower: uniform(2.5),

      // Kept in lockstep with compute.uGroupOffset.
      uGroupOffset: uniform(new THREE.Vector3()),
    },
  };
}

export type GrassUniforms = ReturnType<typeof createGrassUniforms>;
export type GrassSharedUniforms = GrassUniforms["shared"];
export type GrassComputeUniforms = GrassUniforms["compute"];
export type GrassMaterialUniforms = GrassUniforms["material"];
