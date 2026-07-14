// ── SENSE MODULE: Infrarot / thermal image ─────────────────────
//
// Ported from ShaderSinneModul `src/core/senses/infrared.js`. `surface.tempK` is
// spread over a Kelvin window [tempMin, tempMax] onto 0..1 (a thermal camera's
// auto-range) and coloured through a freely adjustable 4-stop palette. Presets
// (Ironbow/Graustufen/Arktis) only write the stop uniforms — no recompile.

import { clamp, max, mix, pow, smoothstep } from "three/tsl";
import type { ShaderSense } from "../sense-types.ts";
import { colorUniform, scalarUniform } from "../uniforms.ts";

const IRONBOW = { c0: "#000005", c1: "#4a0d67", c2: "#f07312", c3: "#fffad1" };
const GRAU = { c0: "#000000", c1: "#565656", c2: "#ababab", c3: "#ffffff" };
const ARKTIS = { c0: "#03045e", c1: "#0077b6", c2: "#90e0ef", c3: "#ffffff" };

export function createInfrared(): ShaderSense {
  // Window defaults hug the scene's ACTUAL span (~283-312 K: water 285, ground
  // 287±10 facing, grass 293, flora 293-297, sun-baked rock up to ~305) so the
  // full palette is used — a thermal camera's auto-range, hand-tuned. The old
  // [285, 330] left the top half of the palette (the hot whites) unused and
  // everything mushed into violet.
  const tempMin = scalarUniform(283.0);
  const tempMax = scalarUniform(312.0);
  const gamma = scalarUniform(1.0);
  const c0 = colorUniform(IRONBOW.c0);
  const c1 = colorUniform(IRONBOW.c1);
  const c2 = colorUniform(IRONBOW.c2);
  const c3 = colorUniform(IRONBOW.c3);

  return {
    key: "infrarot",
    label: "Infrarot (Wärme)",
    description:
      "Oberflächentemperatur als Bild: warme Körper und Sonnenhänge glühen, Wasser und Himmel bleiben kalt. Palette frei — vom Ironbow-Klischee bis Schwarz-Weiß.",
    enabled: scalarUniform(0.0),
    opacity: scalarUniform(1.0),
    range: scalarUniform(600.0),
    rangeSoft: scalarUniform(80.0),
    blendMode: "normal",
    params: { tempMin, tempMax, gamma, c0, c1, c2, c3 },
    ui: [
      {
        key: "tempMin",
        label: "Fenster min (K)",
        type: "range",
        min: 230,
        max: 330,
        step: 1,
        digits: 0,
      },
      {
        key: "tempMax",
        label: "Fenster max (K)",
        type: "range",
        min: 260,
        max: 420,
        step: 1,
        digits: 0,
      },
      { key: "gamma", label: "Gamma", type: "range", min: 0.2, max: 4, step: 0.05, hardMin: 0.01 },
      {
        label: "Palette",
        type: "presets",
        options: [
          { label: "Ironbow", values: IRONBOW },
          { label: "Graustufen", values: GRAU },
          { label: "Arktis", values: ARKTIS },
        ],
      },
      { key: "c0", label: "Stop 1 (kalt)", type: "color" },
      { key: "c1", label: "Stop 2", type: "color" },
      { key: "c2", label: "Stop 3", type: "color" },
      { key: "c3", label: "Stop 4 (heiß)", type: "color" },
    ],

    build(surface) {
      const linear = clamp(smoothstep(tempMin, tempMax, surface.tempK), 0.0, 1.0);
      const t = pow(linear, max(gamma, 0.01));
      const a = mix(c0, c1, smoothstep(0.0, 1.0 / 3.0, t));
      const b = mix(a, c2, smoothstep(1.0 / 3.0, 2.0 / 3.0, t));
      return mix(b, c3, smoothstep(2.0 / 3.0, 1.0, t));
    },
  };
}
