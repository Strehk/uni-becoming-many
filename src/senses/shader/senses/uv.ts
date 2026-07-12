// ── SENSE MODULE: UV perception (bee / bird) ───────────────────
//
// Ported from ShaderSinneModul `src/core/senses/uv.js`. Reveals the UV reflectance
// sitting on the object (surface.uvSignal): nectar guides on blossoms, fluorescent
// lichen on bark, matte leaves. Colours freely selectable — revelation over realism.

import { clamp, mix, oneMinus, smoothstep } from "three/tsl";
import type { ShaderSense } from "../sense-types.ts";
import { colorUniform, scalarUniform } from "../uniforms.ts";

export function createUV(): ShaderSense {
  const lo = scalarUniform(0.2);
  const hi = scalarUniform(0.8);
  const gain = scalarUniform(1.0);
  const invert = scalarUniform(0.0);
  const signalColor = colorUniform("#8a3cff");
  const baseColor = colorUniform("#000000");

  return {
    key: "uv",
    label: "UV-Reflexion",
    description:
      "Zeigt, was nur im Ultravioletten existiert: Nektar-Landebahnen auf Blüten, Flechten auf Rinde. Signal-Farbe markiert das Aufgedeckte, Umgebungs-Farbe den Rest.",
    enabled: scalarUniform(0.0),
    opacity: scalarUniform(1.0),
    range: scalarUniform(600.0),
    rangeSoft: scalarUniform(80.0),
    blendMode: "screen",
    params: { lo, hi, gain, invert, signalColor, baseColor },
    ui: [
      { key: "lo", label: "Schwelle unten", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "hi", label: "Schwelle oben", type: "range", min: 0, max: 1, step: 0.01 },
      { key: "gain", label: "Verstärkung", type: "range", min: 0, max: 4, step: 0.05 },
      { key: "invert", label: "Invertieren", type: "check" },
      { key: "signalColor", label: "Signal-Farbe", type: "color" },
      { key: "baseColor", label: "Umgebungs-Farbe", type: "color" },
    ],

    build(surface) {
      const raw = clamp(smoothstep(lo, hi, surface.uvSignal).mul(gain), 0.0, 1.0);
      const s = mix(raw, oneMinus(raw), invert);
      return mix(baseColor, signalColor, s);
    },
  };
}
