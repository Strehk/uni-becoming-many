// ── Becoming Many — Water Surface Material ─────────────────────
//
// One MeshBasicNodeMaterial shared by every chunk's water (ocean + lakes + river
// ribbons). The geometry is real, built at the surface height by the worldgen
// worker with a per-vertex depth/foam tint baked into the `color` attribute; this
// material normally delegates colour to the active shader-sense compositor, just
// like terrain. That keeps echolocation as a real greyscale depth read instead of
// letting an independent water/sky shader tint it.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  clamp,
  dot,
  float,
  mix,
  normalize,
  positionView,
  positionWorld,
  pow,
  sin,
  vec3,
} from "three/tsl";
import { DoubleSide, MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { cameraPos } from "../../render/camera-pos.ts";
import { distanceFog, viewReveal } from "../../render/tsl-kit.ts";
import type { TerrainLayerCompositor, TimeNode } from "./terrain-material.ts";
import type { KitUniforms } from "./uniforms.ts";

export interface WaterMaterialHandle {
  material: MeshBasicNodeMaterial;
  rewire(): void;
}

/** Build the shared water material. `uTime` drives the fallback ripple look; `u` the sense fade. */
export function createWaterMaterial(
  u: KitUniforms,
  uTime: TimeNode,
  layers?: TerrainLayerCompositor,
): WaterMaterialHandle {
  const mat = new MeshBasicNodeMaterial();

  const rewire = (): void => {
    const base = attribute<"vec3">("color", "vec3");
    const pw = positionWorld;
    let col: Node<"vec3"> | Node<"color">;

    if (layers) {
      col = layers.buildColorNode({
        albedo: base,
        tempK: float(285),
        uvSignal: float(0),
        distance: positionView.z.negate(),
        light: float(1),
      });
    } else {
      const sunDir = vec3(0.4, 0.7, 0.4);
      // Fallback only for standalone water without the sense compositor.
      const nx = sin(pw.x.mul(0.085).add(uTime.mul(1.4)))
        .mul(0.06)
        .add(sin(pw.x.add(pw.z).mul(0.05).sub(uTime.mul(1.1))).mul(0.04));
      const nz = sin(pw.z.mul(0.09).add(uTime.mul(1.2)))
        .mul(0.06)
        .add(sin(pw.z.sub(pw.x).mul(0.045).add(uTime)).mul(0.04));
      const N = normalize(vec3(nx, float(1), nz));
      const viewDir = normalize(cameraPos.sub(pw));
      const viewT = cameraPos.distance(pw).sub(u.fogNear).div(u.fogFar.sub(u.fogNear)).clamp(0, 1);
      const senseTint = mix(u.colorNear, u.colorFar, viewT);
      const waterLuma = dot(base, vec3(0.299, 0.587, 0.114)).clamp(0.65, 1.0);
      const tinted = senseTint.mul(waterLuma);
      const half = normalize(sunDir.add(viewDir));
      const spec = pow(clamp(dot(N, half), 0, 1), 70.0).mul(0.7);
      col = tinted.add(spec);
    }

    // Shared atmosphere: the SAME distance fog the terrain wears (its stage 2) —
    // without it water sits visibly darker/brighter than land at equal distance,
    // which breaks e.g. echo's pure depth read. Then the sense fade: dissolve into
    // the void with the terrain's view bubble, gated by the master reveal so the
    // water vanishes entirely while no sense is active.
    const fogged = distanceFog(col, u.fogColor, u.fogNear, u.fogFar);
    const reveal = viewReveal(u.viewRadius, u.revealSoftness).mul(u.worldReveal);
    mat.colorNode = mix(u.fogColor, fogged, reveal);
    mat.opacityNode = clamp(float(0.82), 0, 0.96).mul(reveal);
    mat.needsUpdate = true;
  };

  rewire();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  return { material: mat, rewire };
}
