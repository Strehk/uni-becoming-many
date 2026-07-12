// ── Becoming Many — Terrain Sense Uniforms ─────────────────────
//
// The kit/sense uniforms as live TSL `uniform()` nodes. A factory so the inferred
// return type (`KitUniforms`) keeps the node math methods — typing it structurally
// would mask them. The SenseManager (later phase) can lerp `.value` on each.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`.

import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/** Build the live sense uniforms shared by the terrain + water materials. */
export function createSenseUniforms() {
  return {
    viewRadius: uniform(160),
    revealSoftness: uniform(28),
    depthLevels: uniform(6),
    fogNear: uniform(30),
    fogFar: uniform(220),
    rimPower: uniform(2.5),
    rimStrength: uniform(0.6),
    colorNear: uniform(new THREE.Color(0x8fa86a)),
    colorFar: uniform(new THREE.Color(0x6a7a88)),
    fogColor: uniform(new THREE.Color(0x0a0a14)),
    rimColor: uniform(new THREE.Color(0x9fc0ff)),
    /** Master world visibility 0..1 (0 = pale void, no sense active). */
    worldReveal: uniform(0),
  };
}

export type KitUniforms = ReturnType<typeof createSenseUniforms>;
