// ── Becoming Many — Water Surface Material ─────────────────────
//
// One MeshBasicNodeMaterial shared by every chunk's water (ocean + lakes + river
// ribbons). The geometry is real, built at the surface height by the worldgen
// worker with a per-vertex depth/foam tint baked into the `color` attribute; this
// material shades it: animated ripple normals, a view-angle fresnel toward the
// sky, and a sun glint. On top of that it fades into the sense void with the SAME
// view bubble as the terrain (viewReveal), so water belongs to the current sense.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  vec3,
} from "three/tsl";
import { DoubleSide, MeshBasicNodeMaterial } from "three/webgpu";
import type { TimeNode } from "./terrain-material.ts";
import { viewReveal } from "./tsl-kit.ts";
import type { KitUniforms } from "./uniforms.ts";

/** Build the shared water material. `uTime` drives ripples; `u` the sense fade. */
export function createWaterMaterial(u: KitUniforms, uTime: TimeNode): MeshBasicNodeMaterial {
  const sunDir = vec3(0.4, 0.7, 0.4);
  const mat = new MeshBasicNodeMaterial();

  const base = attribute<"vec3">("color", "vec3");
  const pw = positionWorld;

  // Cheap travelling waves perturb only the shading normal (geometry stays flat).
  const nx = sin(pw.x.mul(0.085).add(uTime.mul(1.4)))
    .mul(0.06)
    .add(sin(pw.x.add(pw.z).mul(0.05).sub(uTime.mul(1.1))).mul(0.04));
  const nz = sin(pw.z.mul(0.09).add(uTime.mul(1.2)))
    .mul(0.06)
    .add(sin(pw.z.sub(pw.x).mul(0.045).add(uTime)).mul(0.04));
  const N = normalize(vec3(nx, float(1), nz));

  const viewDir = normalize(cameraPosition.sub(pw));
  const fres = pow(clamp(float(1).sub(dot(N, viewDir)), 0, 1), 3.0);
  const sky = vec3(0.6, 0.74, 0.88);
  const tinted = mix(base, sky, fres.mul(0.55));

  // Sun specular glint (Blinn-Phong halfway vector).
  const half = normalize(sunDir.add(viewDir));
  const spec = pow(clamp(dot(N, half), 0, 1), 70.0).mul(0.7);
  const col = tinted.add(spec);

  // Sense fade: dissolve into the void with the terrain's view bubble.
  const reveal = viewReveal(u.viewRadius, u.revealSoftness);
  mat.colorNode = mix(u.fogColor, col, reveal);
  mat.opacityNode = clamp(
    float(0.72)
      .add(fres.mul(0.24))
      .add(max(spec, float(0))),
    0,
    0.96,
  ).mul(reveal);
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = DoubleSide;
  return mat;
}
