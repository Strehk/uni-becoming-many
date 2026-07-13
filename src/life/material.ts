// ── Becoming Many — Flora Material ─────────────────────────────
//
// One MeshBasicNodeMaterial (UNLIT) per species. The flora is a `SenseSurface`
// exactly like terrain and water: its per-instance tint (the asset's own material
// colour, jittered per plant) is the albedo the shader-sense compositor layers
// over, then the SAME sense look follows — distanceFog + viewReveal + fresnelEdge —
// so a sense transition restyles flora and ground together, and the echo sense
// reads plants as pure view depth instead of foreign silhouettes.
//
// UNLIT is deliberate and load-bearing (AGENT.md "the white void is load-bearing"):
// the scene has NO lights — lighting flows through the senses as the `light`
// surface field. The previous MeshStandardNodeMaterial had no light to see by, so
// its diffuse colour rendered black and flora showed only as emissive silhouettes.
// A basic material has no emissive slot either, so the glow (fresnel rim +
// awakening pulse) is ADDED into the colorNode — additive is what emissive did.
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
//     and fold it into the compositor's albedo BEFORE the fog instead.
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
  normalWorld,
  positionGeometry,
  positionLocal,
  positionView,
  smoothstep,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
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

/** The surface fields flora hands to the sense-layer compositor — structurally the
 *  same `SurfaceDesc` terrain + water pass (declared here so `life` never imports
 *  the senses module, mirroring the terrain's own declaration). */
export interface FloraSurfaceNodes {
  albedo: Node<"vec3">;
  tempK: Node<"float">;
  uvSignal: Node<"float">;
  distance: Node<"float">;
  light: Node<"float">;
}

/** The sense-layer compositor flora consumes (implemented by
 *  `createShaderSenses().compositor`, same object the terrain gets). */
export interface FloraLayerCompositor {
  buildColorNode(surface: FloraSurfaceNodes): Node<"vec3"> | Node<"color">;
  /** Subscribe to structural changes (blend mode / order). Returns an unsubscribe. */
  onStructureChange(cb: () => void): () => void;
}

export interface FloraMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Rebuild colorNode after a structural sense change (blend mode / layer order). */
  rewire(): void;
}

/** Build the material for one part of one species. The part's own albedo travels
 *  per-instance in `instanceTint`, so every part of a species shares this graph. */
export function createFloraMaterial(
  def: SpeciesDef,
  u: KitUniforms,
  life: LifeUniforms,
  layers?: FloraLayerCompositor,
): FloraMaterialHandle {
  const material = new MeshBasicNodeMaterial();
  // Grass, flowers and foliage are single-sided planes in the source meshes.
  material.side = THREE.DoubleSide;

  // ── The awakening pulse ───────────────────────────────────────────────────
  // A branchless rise-then-decay off the per-instance stamp. For a never-woken
  // plant the age is enormous, so the decay term is already 0 — no sentinel test.
  const age = life.clock.sub(attribute<"float">("instanceAwaken", "float"));
  const pulse = smoothstep(float(0), float(PULSE_RISE), age).mul(
    smoothstep(float(PULSE_RISE), float(PULSE_FALL), age).oneMinus(),
  );

  const rewire = (): void => {
    // ── Colour: instance tint → sense layers → fog → reveal, plus the glow ───
    const reveal = viewReveal(u.viewRadius, u.revealSoftness);
    const tint = attribute<"vec3">("instanceTint", "vec3");

    // The plant as SenseSurface, through the SAME compositor pass as terrain +
    // water: echo reads pure camera depth, infrarot reads plants a touch warmer
    // than the ground (they are alive), farben shades them with the shared sun.
    let base: Node<"vec3"> | Node<"color"> = tint;
    if (layers) {
      const facing = normalWorld.dot(vec3(0.4, 0.75, 0.3).normalize()).clamp(0, 1);
      base = layers.buildColorNode({
        albedo: tint,
        tempK: float(296).add(facing.mul(8)),
        uvSignal: float(0.35),
        distance: positionView.z.negate(),
        light: facing.mul(0.65).add(0.35),
      });
    }
    const fogged = distanceFog(base, u.fogColor, u.fogNear, u.fogFar);

    // Fresnel rim + self-glow, both lifted by the pulse — added, not emissive
    // (unlit material). Sense-gated twice over: rimStrength and bioluminescence
    // are both 0-able per sense, so e.g. echo's depth map stays near-pure.
    const glow = life.bioluminescence;
    const rim = fresnelEdge(u.rimPower).mul(u.rimStrength);
    const lit = rim.mul(glow.mul(0.6).add(0.25)).add(pulse.mul(glow.mul(0.8).add(0.3)));
    const shine = u.rimColor.mul(lit.mul(reveal).mul(life.emissiveGain.mul(0.5).add(0.75)));

    material.colorNode = mix(u.fogColor, fogged, reveal).add(shine);
    material.needsUpdate = true;
  };
  rewire();

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

  return { material, rewire };
}
