// ── Becoming Many — Shared Terrain Material ────────────────────
//
// One MeshBasicNodeMaterial (UNLIT) reused by every streamed chunk. Chunk geometry is
// built on the CPU in a worker; the per-vertex biome albedo arrives as a "color"
// attribute (baked from the biome profile + rock + snow).
//
// The material is deliberately unlit: in "Becoming Many" the world is INVISIBLE until a
// sense reveals it — with no sense active the terrain must render as flat void colour,
// indistinguishable from the sky. A lit (PBR) material would betray the terrain's form
// through shading even on a white albedo, so lighting instead flows *through the senses*:
// a lambert factor is folded into the compositor's `light` field (the `farben` sense
// reveals shaded form), exactly as the ShaderSinneModul design intended.
//
// Stages:
//   1. the per-sense colour layers over the biome albedo — the terrain is the
//      `SenseSurface`: albedo = vertex colour, tempK derived procedurally, uvSignal from
//      lichen blotches, light = lambert (sun · normal);
//   2. the shared atmosphere look (distanceFog + viewReveal + fresnel rim);
//   3. the **master reveal**: `mix(fogColor, styled, worldReveal)` — worldReveal is 0
//      while no sense is active, so the whole world collapses to the void colour.
//
// Structural sense changes (blend mode, layer order) rebuild the colorNode via `rewire()`.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionView,
  positionWorld,
  smoothstep,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { distanceFog, fresnelEdge, viewReveal } from "../../render/tsl-kit.ts";
import type { KitUniforms } from "./uniforms.ts";

/** Clock uniform node driving the rim "breath" — e.g. TSL `time`. */
export type TimeNode = Node<"float">;

/** The surface fields the terrain hands to the sense-layer compositor. */
export interface TerrainSurfaceNodes {
  albedo: Node<"vec3">;
  tempK: Node<"float">;
  uvSignal: Node<"float">;
  /** Camera-view depth in metres, used by echolocation. */
  distance: Node<"float">;
  /** Lighting factor for colour shading — a real lambert term (the `farben` sense
   *  reveals shaded form; other senses ignore it). */
  light: Node<"float">;
}

/**
 * The sense-layer compositor the terrain consumes (implemented by
 * `createShaderSenses().compositor` — declared structurally here so the terrain
 * module never imports the senses module).
 */
export interface TerrainLayerCompositor {
  buildColorNode(surface: TerrainSurfaceNodes): Node<"vec3"> | Node<"color">;
  /** Subscribe to structural changes (blend mode / order). Returns an unsubscribe. */
  onStructureChange(cb: () => void): () => void;
}

export interface TerrainMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Rebuild colorNode after a structural sense change. */
  rewire(): void;
}

/**
 * Build the shared terrain material. `uTime` is the clock uniform node (rim
 * "breath"); `u` are the live sense uniforms the SenseManager lerps; `layers`
 * (optional) composites the per-sense colour layers over the biome albedo.
 */
export function createTerrainMaterial(
  u: KitUniforms,
  uTime: TimeNode,
  layers?: TerrainLayerCompositor,
): TerrainMaterialHandle {
  const material = new MeshBasicNodeMaterial();
  // Chunk index winding follows PlaneGeometry; double-side avoids culling the
  // ground when its base winding faces away.
  material.side = THREE.DoubleSide;

  const rewire = (): void => {
    // ── Stage 1: sense layers over the per-vertex biome colour ──
    const albedo = attribute<"vec3">("color", "vec3");
    // Lambert shading term (sun · normal), folded into the compositor's `light` — the
    // terrain's form only appears once the `farben` sense reveals it.
    const facing = normalWorld.dot(vec3(0.4, 0.75, 0.3).normalize()).clamp(0, 1);
    const lambert = facing.mul(0.65).add(0.35);
    let base: Node<"vec3"> | Node<"color"> = albedo;
    if (layers) {
      // The terrain as SenseSurface. tempK: ~287 K base, sun-facing slopes warm by up
      // to +16 K, altitude cools (−0.1 K/m). uvSignal: fluorescent lichen on steep
      // rock faces + a faint foliage sheen on the rest.
      const altitude = positionWorld.y.max(0.0);
      const tempK = float(287).add(facing.mul(16)).sub(altitude.mul(0.1));

      const slope = float(1).sub(normalWorld.y.clamp(0, 1));
      const lichen = lichenSignal(slope);

      const viewDepth = positionView.z.negate();
      base = layers.buildColorNode({
        albedo,
        tempK,
        uvSignal: lichen,
        distance: viewDepth,
        light: lambert,
      });
    }

    // ── Stage 2: shared atmosphere look + rim ──
    const fogged = distanceFog(base, u.fogColor, u.fogNear, u.fogFar);
    const reveal = viewReveal(u.viewRadius, u.revealSoftness);
    const styled = mix(u.fogColor, fogged, reveal);

    const breath = uTime.mul(0.8).sin().mul(0.15).add(0.85); // 0.7 … 1.0
    const rim = fresnelEdge(u.rimPower).mul(u.rimStrength).mul(reveal).mul(breath);
    const lit = styled.add(u.rimColor.mul(rim));

    // ── Stage 3: master reveal — the void until a sense unlocks the world ──
    material.colorNode = mix(u.fogColor, lit, u.worldReveal);

    material.needsUpdate = true;
  };

  rewire();
  return { material, rewire };
}

/** Organic lichen blotches, gated to steep faces (inlined so the terrain module
 *  stays free of a senses import — same recipe as `uvSignals.lichenBlotches`). */
function lichenSignal(slope: Node<"float">): Node<"float"> {
  const coord = positionWorld.xz.mul(0.35);
  const n = mx_noise_float(coord).mul(0.5).add(0.5);
  const fine = mx_noise_float(coord.mul(2.7)).mul(0.5).add(0.5);
  const blotches = smoothstep(0.55, 0.78, n)
    .mul(mix(float(0.5), float(1.0), fine))
    .clamp(0, 1);
  return smoothstep(0.25, 0.6, slope).mul(blotches).add(0.06);
}
