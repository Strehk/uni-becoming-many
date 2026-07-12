// ── SENSE MODULE: Wahrnehmbare Farben (normal colour vision) ───
//
// Ported from ShaderSinneModul `src/core/senses/farben.js`. Reveals the surface's
// "true" visible colour (surface.albedo) — the ordinary image that uncovers the white
// world. Brightness, saturation, gamma and form shading freely adjustable (down to
// greyscale).

import { clamp, dot, float, max, mix, pow, vec3 } from "three/tsl";
import type { ShaderSense } from "../sense-types.ts";
import { scalarUniform } from "../uniforms.ts";

export function createFarben(): ShaderSense {
  const brightness = scalarUniform(1.0);
  const saturation = scalarUniform(1.0);
  const gamma = scalarUniform(1.0);
  const shade = scalarUniform(0.6); // 0 = flat, 1 = full form shading

  return {
    key: "farben",
    label: "Wahrnehmbare Farben",
    description:
      "Das normale sichtbare Farbbild der Welt — der Ausgangspunkt, über den sich die anderen Sinne legen. Sättigung bis Graustufen, Helligkeit und Gamma frei.",
    enabled: scalarUniform(0.0),
    opacity: scalarUniform(1.0),
    range: scalarUniform(600.0),
    rangeSoft: scalarUniform(80.0),
    blendMode: "normal",
    params: { brightness, saturation, gamma, shade },
    ui: [
      {
        key: "brightness",
        label: "Helligkeit",
        type: "range",
        min: 0,
        max: 3,
        step: 0.01,
        hardMin: 0,
      },
      {
        key: "saturation",
        label: "Sättigung",
        type: "range",
        min: 0,
        max: 2,
        step: 0.01,
        hardMin: 0,
      },
      { key: "gamma", label: "Gamma", type: "range", min: 0.2, max: 4, step: 0.05, hardMin: 0.01 },
      { key: "shade", label: "Schattierung", type: "range", min: 0, max: 1, step: 0.01 },
    ],

    build(surface) {
      const lit = surface.albedo.mul(mix(float(1.0), surface.light, shade));
      const luma = dot(lit, vec3(0.299, 0.587, 0.114));
      const saturated = mix(vec3(luma), lit, saturation);
      const graded = pow(max(saturated, 0.0), max(gamma, 0.01)).mul(brightness);
      return clamp(graded, 0.0, 1.0);
    },
  };
}
