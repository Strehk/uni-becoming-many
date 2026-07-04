// ── Becoming Many — Shared Terrain Material ────────────────────
//
// One MeshStandardNodeMaterial reused by every streamed chunk. Chunk geometry is
// built on the CPU in a worker; the per-vertex biome albedo arrives as a "color"
// attribute (baked from the biome profile + rock + snow). The material takes that
// as the base albedo and layers the shared sense look over it (distanceFog +
// viewReveal + fresnelEdge rim), so one sense transition restyles the world.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import { attribute, mix } from "three/tsl";
import * as THREE from "three/webgpu";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { distanceFog, fresnelEdge, viewReveal } from "./tsl-kit.ts";
import type { KitUniforms } from "./uniforms.ts";

/** Clock uniform node driving the rim "breath" — e.g. TSL `time`. */
export type TimeNode = Node<"float">;

/**
 * Build the shared terrain material. `uTime` is the clock uniform node (rim
 * "breath"); `u` are the live sense uniforms the SenseManager lerps.
 */
export function createTerrainMaterial(u: KitUniforms, uTime: TimeNode): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.metalness = 0.0;
  material.roughness = 0.95;
  // Chunk index winding follows PlaneGeometry; double-side avoids culling the
  // ground when its base winding faces away.
  material.side = THREE.DoubleSide;

  // ── Base albedo from the per-vertex biome colour, then the sense look ──
  const albedo = attribute<"vec3">("color", "vec3");

  const fogged = distanceFog(albedo, u.fogColor, u.fogNear, u.fogFar);
  const reveal = viewReveal(u.viewRadius, u.revealSoftness);
  material.colorNode = mix(u.fogColor, fogged, reveal);

  const breath = uTime.mul(0.8).sin().mul(0.15).add(0.85); // 0.7 … 1.0
  const rim = fresnelEdge(u.rimPower).mul(u.rimStrength).mul(reveal).mul(breath);
  material.emissiveNode = u.rimColor.mul(rim);

  return material;
}
