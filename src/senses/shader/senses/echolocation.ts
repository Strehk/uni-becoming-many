// ── SENSE MODULE: Echoortung (bat sonar) — depth/form from distance ──
//
// Ported from ShaderSinneModul `src/core/senses/echolocation.js`. Basis is the
// fragment↔camera distance (a "depth map" in the material): near → nearColor,
// far → farColor. Optionally quantized into sonar rings and overlaid with a
// travelling echo ping (both uniform-driven, no recompile).

import {
  abs,
  clamp,
  float,
  floor,
  max,
  mix,
  mod,
  oneMinus,
  pow,
  smoothstep,
  step,
} from "three/tsl";
import type { ShaderSense } from "../sense-types.ts";
import { colorUniform, scalarUniform, uTime } from "../uniforms.ts";

export function createEcholocation(): ShaderSense {
  const near = scalarUniform(2.0);
  const far = scalarUniform(140.0);
  const gamma = scalarUniform(1.0);
  const nearColor = colorUniform("#000000");
  const farColor = colorUniform("#ffffff");
  const bands = scalarUniform(0.0); // 0/1 = off, ≥2 = sonar rings
  const pingStrength = scalarUniform(0.0); // 0 = off
  const pingSpeed = scalarUniform(30.0);
  const pingWidth = scalarUniform(5.0);

  return {
    key: "echo",
    label: "Echoortung (Tiefe)",
    description:
      "Distanz wird Helligkeit: Nahes leuchtet, Fernes versinkt. Sonar-Ringe quantisieren die Tiefe, der Ping schickt eine Echowelle durch die Welt.",
    enabled: scalarUniform(0.0),
    opacity: scalarUniform(1.0),
    range: scalarUniform(600.0),
    rangeSoft: scalarUniform(80.0),
    blendMode: "multiply",
    params: { near, far, gamma, nearColor, farColor, bands, pingStrength, pingSpeed, pingWidth },
    ui: [
      { key: "near", label: "Nah-Distanz", type: "range", min: 0.5, max: 60, step: 0.5, digits: 1 },
      { key: "far", label: "Fern-Distanz", type: "range", min: 10, max: 500, step: 1, digits: 0 },
      { key: "gamma", label: "Gamma", type: "range", min: 0.2, max: 4, step: 0.05, hardMin: 0.01 },
      { key: "nearColor", label: "Nah-Farbe", type: "color" },
      { key: "farColor", label: "Fern-Farbe", type: "color" },
      {
        key: "bands",
        label: "Sonar-Ringe",
        type: "range",
        min: 0,
        max: 16,
        step: 1,
        digits: 0,
        hardMin: 0,
      },
      { key: "pingStrength", label: "Ping-Stärke", type: "range", min: 0, max: 1, step: 0.01 },
      {
        key: "pingSpeed",
        label: "Ping-Tempo",
        type: "range",
        min: 2,
        max: 150,
        step: 1,
        digits: 0,
      },
      {
        key: "pingWidth",
        label: "Ping-Breite",
        type: "range",
        min: 0.5,
        max: 30,
        step: 0.5,
        digits: 1,
      },
    ],

    build(surface) {
      const d = surface.distance;
      const linear = clamp(smoothstep(near, far, d), 0.0, 1.0);
      const graded = pow(linear, max(gamma, 0.01));
      // Quantize into sonar rings when bands ≥ 2 (step gate keeps it uniform-driven).
      const quantized = clamp(floor(graded.mul(bands)).div(max(bands.sub(1.0), 1.0)), 0.0, 1.0);
      const banded = mix(graded, quantized, step(1.5, bands));
      // The travelling echo ping: a bright ring moving outward, wrapping at `far`.
      const ringPos = mod(uTime.mul(pingSpeed), max(far, 1.0));
      const ring = oneMinus(smoothstep(float(0.0), max(pingWidth, 0.01), abs(d.sub(ringPos))));
      const t = clamp(banded.sub(ring.mul(pingStrength)), 0.0, 1.0);
      return mix(nearColor, farColor, t);
    },
  };
}
