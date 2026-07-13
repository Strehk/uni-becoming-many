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
// A basic material has no emissive slot either, so the glow (the fresnel rim) is
// ADDED into the colorNode — additive is what emissive did.
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
// former is the virtual clock, so pausing the transport freezes the wind.
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
  texture,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { distanceFog, fresnelEdge, viewReveal } from "../render/tsl-kit.ts";
import type { KitUniforms } from "../render/uniforms.ts";
import { TAU } from "./matrix.ts";
import type { SpeciesDef } from "./species.ts";
import type { LifeUniforms } from "./uniforms.ts";

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

/** Flora-wide sense-surface defaults — a species overrides them via `def.senses`. */
const DEFAULT_TEMP_K = 296;
const DEFAULT_TEMP_FACING_K = 8;
const DEFAULT_UV_SIGNAL = 0.35;

/** Alpha-cutout threshold for foliage cards. Cutout (not blending) keeps the
 *  depth write and needs no sorting — right for instanced crowns. */
const FOLIAGE_ALPHA_TEST = 0.5;

/** Build the material for one part of one species. The part's own albedo travels
 *  per-instance in `instanceTint`, so parts of a species share this graph — split
 *  only into a solid and a foliage variant.
 *
 *  `foliageAtlas` switches the foliage variant on: the nature-kit's crowns/bushes
 *  are 1-2 m cutout cards whose shape lives in a shared greyscale+alpha atlas
 *  (see scripts/convert-nature.ts). RGB is shading (multiplied over the tint),
 *  alpha is the cutout mask. */
export function createFloraMaterial(
  def: SpeciesDef,
  u: KitUniforms,
  life: LifeUniforms,
  layers?: FloraLayerCompositor,
  foliageAtlas?: THREE.Texture,
): FloraMaterialHandle {
  const material = new MeshBasicNodeMaterial();
  // Grass, flowers and foliage are single-sided planes in the source meshes.
  material.side = THREE.DoubleSide;

  if (foliageAtlas) {
    material.opacityNode = texture(foliageAtlas, uv()).a;
    material.alphaTest = FOLIAGE_ALPHA_TEST;
  }

  const rewire = (): void => {
    // ── Colour: instance tint → sense layers → fog → reveal, plus the glow ───
    const reveal = viewReveal(u.viewRadius, u.revealSoftness);
    let tint: Node<"vec3"> = attribute<"vec3">("instanceTint", "vec3");
    if (foliageAtlas) {
      // Greyscale atlas shading over the species tint — leaf-cluster depth
      // without per-leaf geometry.
      tint = tint.mul(texture(foliageAtlas, uv()).r);
    }

    // The plant as SenseSurface, through the SAME compositor pass as terrain +
    // water: echo reads pure camera depth, infrarot reads plants a touch warmer
    // than the ground (they are alive) unless the species says otherwise (dead
    // wood is ambient-cold, mushrooms run decomposition-warm, stone soaks sun),
    // farben shades them with the shared sun.
    const tempK = def.senses?.tempK ?? DEFAULT_TEMP_K;
    const tempFacingK = def.senses?.tempFacingK ?? DEFAULT_TEMP_FACING_K;
    const uvSignal = def.senses?.uvSignal ?? DEFAULT_UV_SIGNAL;

    let base: Node<"vec3"> | Node<"color"> = tint;
    if (layers) {
      const facing = normalWorld.dot(vec3(0.4, 0.75, 0.3).normalize()).clamp(0, 1);
      base = layers.buildColorNode({
        albedo: tint,
        tempK: float(tempK).add(facing.mul(tempFacingK)),
        uvSignal: float(uvSignal),
        distance: positionView.z.negate(),
        light: facing.mul(0.65).add(0.35),
      });
    }
    const fogged = distanceFog(base, u.fogColor, u.fogNear, u.fogFar);

    // Fresnel rim self-glow — added, not emissive (unlit material). Sense-gated
    // twice over: rimStrength and bioluminescence are both 0-able per sense, so
    // e.g. echo's depth map stays near-pure.
    const glow = life.bioluminescence;
    const rim = fresnelEdge(u.rimPower).mul(u.rimStrength);
    const lit = rim.mul(glow.mul(0.6).add(0.25));
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
    const amplitude = life.swayStrength.mul(def.sway);
    const bend = vec3(
      wave.mul(amplitude).mul(mask),
      float(0),
      wave.mul(0.6).mul(amplitude).mul(mask),
    );
    material.positionNode = positionLocal.add(bend); // ← positionLocal, NOT positionGeometry
  }

  return { material, rewire };
}
