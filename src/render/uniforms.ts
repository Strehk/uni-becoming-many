// ── Becoming Many — Shared Sense Uniforms ──────────────────────
//
// The one live set of TSL `uniform()` nodes describing "how the world looks right
// now". The SenseManager (src/senses/) is the sole writer — it lerps `.value` on
// each toward the active sense's profile. Every material that wants to belong to
// the current sense (terrain, water, flora) reads this same set, so a single sense
// transition restyles the whole world.
//
// Neutral by design. This module must NOT import `senses` (that would cycle:
// senses → render → senses), so the factory takes a plain numeric seed rather than
// a SenseProfile. `SenseProfile` is structurally assignable to `SenseUniformSeed`,
// so `senses` just passes a profile straight in.
//
// A factory (not a plain object literal) so the inferred return type keeps the node
// math methods — typing it structurally as `{ value: number }` would mask them and
// break `u.rimColor.mul(...)` in a node graph.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`.

import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/** Plain-data description of a look: 7 scalars + 4 hex colours. */
export interface SenseUniformSeed {
  /** How far you can see, in metres (the view-radius cutoff). */
  viewRadius: number;
  /** Width of the soft fade at the reveal edge, in metres. */
  revealSoftness: number;
  /** Quantized depth-band count ("papercut"); high ≈ continuous. */
  depthLevels: number;
  fogNear: number;
  fogFar: number;
  rimPower: number;
  rimStrength: number;
  /** Near-distance tint (hex). */
  colorNear: number;
  /** Far-distance tint (hex). */
  colorFar: number;
  /** Haze / void colour the world dissolves into (hex). */
  fogColor: number;
  /** Fresnel edge-glow colour (hex). */
  rimColor: number;
  /** Presence of the ambient dust motes, 0..1 (echo zeroes it — pure depth map). */
  dustStrength: number;
}

/** The look a world opens with when no sense is driving it yet. */
export const DEFAULT_SENSE_SEED: SenseUniformSeed = {
  viewRadius: 160,
  revealSoftness: 28,
  depthLevels: 6,
  fogNear: 30,
  fogFar: 220,
  rimPower: 2.5,
  rimStrength: 0.6,
  colorNear: 0x8fa86a,
  colorFar: 0x6a7a88,
  fogColor: 0x0a0a14,
  rimColor: 0x9fc0ff,
  dustStrength: 1,
};

/** Build the live sense uniforms, seeded to `seed`. */
export function createSenseUniforms(seed: SenseUniformSeed = DEFAULT_SENSE_SEED) {
  return {
    viewRadius: uniform(seed.viewRadius),
    revealSoftness: uniform(seed.revealSoftness),
    depthLevels: uniform(seed.depthLevels),
    fogNear: uniform(seed.fogNear),
    fogFar: uniform(seed.fogFar),
    rimPower: uniform(seed.rimPower),
    rimStrength: uniform(seed.rimStrength),
    colorNear: uniform(new THREE.Color(seed.colorNear)),
    colorFar: uniform(new THREE.Color(seed.colorFar)),
    fogColor: uniform(new THREE.Color(seed.fogColor)),
    rimColor: uniform(new THREE.Color(seed.rimColor)),
    dustStrength: uniform(seed.dustStrength),
  };
}

export type KitUniforms = ReturnType<typeof createSenseUniforms>;
