// ── UV reflectance generators ──────────────────────────────────
//
// Ported from ShaderSinneModul `src/core/uvSignals.js`.
//
// UV perception is NOT a painted-on pattern but a reflectance property that lives on
// the object: blossoms carry a soft nectar guide (UV-absorbing centre, reflective rim),
// bark/rock fluorescent lichen blotches, foliage barely anything. These helpers create
// exactly such organic 0..1 signals; a scene calls them while describing its surfaces
// and stores the result in `surface.uvSignal` — the UV layer then merely reveals it.

import {
  abs,
  atan,
  clamp,
  cos,
  float,
  length,
  mix,
  mx_noise_float,
  pow,
  smoothstep,
  vec2,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { F, type FloatLike } from "./uniforms.ts";

/**
 * Blossom nectar guide: absorbing centre → reflective rim (the bee "bullseye"), soft,
 * with irregular pigment break-up; ~40% of blossoms additionally carry radial rays.
 * `uvCoord` = blossom UV (0..1, centre 0.5); `hash` = per-instance random for variation.
 */
export function nectarGuide(uvCoord: Node<"vec2">, hash: FloatLike = 0.0): Node<"float"> {
  const h = F(hash);
  const c = uvCoord.sub(vec2(0.5, 0.5)).mul(2.0);
  const r = clamp(length(c), 0.0, 1.0);

  // soft transition absorbing (centre) → reflective (rim)
  const rim = smoothstep(0.16, 0.62, r);
  // organic break-up: slight pigment / vein structure
  const veins = mx_noise_float(c.mul(3.5).add(h.mul(11.0)))
    .mul(0.5)
    .add(0.5);
  const guide = rim.mul(mix(float(0.82), float(1.0), veins));
  // radial landing-strip rays — only on ~40% of blossoms
  const rays = pow(abs(cos(atan(c.y, c.x).mul(5.0))), 4.0).mul(smoothstep(0.15, 0.6, r));
  const hasRays = smoothstep(0.6, 0.62, h);
  return clamp(guide.add(rays.mul(hasRays).mul(0.5)), 0.0, 1.0);
}

/**
 * Bark/rock: fluorescent lichen as organic blotches (no grid). `coord` = any local or
 * world coordinate (vec2), `scale` = blotch size.
 */
export function lichenBlotches(
  coord: Node<"vec2">,
  hash: FloatLike = 0.0,
  scale: FloatLike = 1.6,
): Node<"float"> {
  const h = F(hash);
  const s = F(scale);
  const n = mx_noise_float(coord.mul(s).add(h.mul(7.0)))
    .mul(0.5)
    .add(0.5);
  const fine = mx_noise_float(coord.mul(s.mul(2.7)).add(h.mul(3.0)))
    .mul(0.5)
    .add(0.5);
  return clamp(smoothstep(0.55, 0.78, n).mul(mix(float(0.5), float(1.0), fine)), 0.0, 1.0);
}

/**
 * Foliage/grass: low, broad UV reflectance. `spec` (0..1, optional from the scene's
 * normal·view) lifts the view-dependent specular sheen.
 */
export function foliageSheen(base: FloatLike = 0.12, spec: FloatLike = 0.0): Node<"float"> {
  return clamp(F(base).add(F(spec).mul(0.3)), 0.0, 1.0);
}
