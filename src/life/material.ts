// ── Becoming Many — Flora Material ─────────────────────────────
//
// One MeshStandardNodeMaterial per species-part. Albedo is the per-instance tint
// (the asset's own material colour, jittered per plant); over it goes the SAME
// sense look the terrain wears — distanceFog + viewReveal + fresnelEdge — so a
// sense transition restyles flora and ground together.
//
// Two instancing traps this material is written around (three r185, verified):
//
//  1. `NodeMaterial.setupPosition()` applies the instance matrix into `positionLocal`
//     and THEN, if a `positionNode` is set, OVERWRITES `positionLocal` with it. So
//     sway must be `positionLocal.add(bend)` — reading the already-instanced value.
//     Writing `positionGeometry.add(bend)` would silently collapse every plant onto
//     the world origin. `positionGeometry` remains the un-instanced object-space
//     vertex, which is exactly what we want for the bend mask up the trunk.
//
//  2. `setupDiffuseColor()` multiplies three's built-in `instanceColor` over the
//     WHOLE `colorNode` — including the fog we mix in here. Setting
//     `mesh.instanceColor` would therefore tint the fog itself (obvious under
//     `luft`, whose fog is pure white). We carry our own `instanceTint` attribute
//     and fold it into albedo BEFORE the fog instead.
//
// Time comes from `life.clock` (mirroring `signals.time`), not TSL's `time`: the
// former is the virtual clock, so pausing the transport freezes the wind, and the
// `instanceAwaken` stamps stay on the same timebase as the wave that reads them.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  float,
  hash,
  instanceIndex,
  mix,
  positionGeometry,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { distanceFog, fresnelEdge, viewReveal } from "../render/tsl-kit.ts";
import type { KitUniforms } from "../render/uniforms.ts";
import { TAU } from "./matrix.ts";
import type { SpeciesDef } from "./species.ts";
import type { LifeUniforms } from "./uniforms.ts";

/** `instanceAwaken` value meaning "this plant has never met the player". Any value
 *  far enough in the past that the decay term has long since reached zero. */
export const NEVER_AWOKEN = -1000;

/** Seconds for the awakening pulse to rise, then to fade back out. */
const PULSE_RISE = 1.2;
const PULSE_FALL = 3.5;
/** Radians per second of the wind's fundamental. */
const SWAY_SPEED = 1.1;

/** Build the material for one part of one species. The part's own albedo travels
 *  per-instance in `instanceTint`, so every part of a species shares this graph. */
export function createFloraMaterial(
  def: SpeciesDef,
  u: KitUniforms,
  life: LifeUniforms,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.metalness = 0;
  material.roughness = 0.9;
  // Grass, flowers and foliage are single-sided planes in the source meshes.
  material.side = THREE.DoubleSide;

  // ── The awakening pulse ───────────────────────────────────────────────────
  // A branchless rise-then-decay off the per-instance stamp. For a never-woken
  // plant the age is enormous, so the decay term is already 0 — no sentinel test.
  const age = life.clock.sub(attribute<"float">("instanceAwaken", "float"));
  const pulse = smoothstep(float(0), float(PULSE_RISE), age).mul(
    smoothstep(float(PULSE_RISE), float(PULSE_FALL), age).oneMinus(),
  );

  // ── Albedo: instance tint → fog → sense reveal ────────────────────────────
  const reveal = viewReveal(u.viewRadius, u.revealSoftness);
  const albedo = attribute<"vec3">("instanceTint", "vec3");
  const fogged = distanceFog(albedo, u.fogColor, u.fogNear, u.fogFar);
  material.colorNode = mix(u.fogColor, fogged, reveal);

  // ── Emissive: fresnel rim + self-glow, both lifted by the pulse ───────────
  const glow = life.bioluminescence;
  const rim = fresnelEdge(u.rimPower).mul(u.rimStrength);
  const lit = rim.mul(glow.mul(0.6).add(0.25)).add(pulse.mul(glow.mul(0.8).add(0.3)));
  material.emissiveNode = u.rimColor.mul(lit.mul(reveal).mul(life.emissiveGain.mul(0.5).add(0.75)));

  // ── Sway ──────────────────────────────────────────────────────────────────
  // Rocks and stumps don't bend: leaving `positionNode` unset keeps the instance
  // transform untouched and spares them the vertex work.
  if (def.sway > 0) {
    // 0 at the base, 1 at the crown — quadratic so trunks stay planted.
    const mask = positionGeometry.y.div(def.targetHeight).clamp(0, 1).pow(2);
    // Free per-instance randomness; no attribute needed.
    const phase = hash(instanceIndex).mul(TAU);
    const wave = life.clock.mul(SWAY_SPEED).add(phase).sin();
    const amplitude = life.swayStrength.mul(def.sway).mul(pulse.mul(1.5).add(1));
    const bend = vec3(
      wave.mul(amplitude).mul(mask),
      float(0),
      wave.mul(0.6).mul(amplitude).mul(mask),
    );
    material.positionNode = positionLocal.add(bend); // ← positionLocal, NOT positionGeometry
  }

  return material;
}
