// ── Blend modes (vec3 → vec3), Photoshop-style ─────────────────
//
// Ported from ShaderSinneModul `src/core/blendModes.js`. The functions are baked
// into the shader on a structural rebuild (changing a layer's blend mode = one
// recompile, see sense-system.ts).

import { abs, clamp, max, min, oneMinus, step } from "three/tsl";
import type { Node } from "three/webgpu";

export type BlendModeKey =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "add"
  | "difference"
  | "darken"
  | "lighten";

export type BlendFn = (base: Node<"vec3">, layer: Node<"vec3">) => Node<"vec3">;

export interface BlendMode {
  key: BlendModeKey;
  label: string;
  fn: BlendFn;
}

const screen: BlendFn = (b, l) => oneMinus(oneMinus(b).mul(oneMinus(l)));

export const BLEND_MODES: readonly BlendMode[] = [
  { key: "normal", label: "Normal", fn: (_b, l) => l },
  { key: "multiply", label: "Multiplizieren", fn: (b, l) => b.mul(l) },
  { key: "screen", label: "Negativ multiplizieren", fn: screen },
  {
    key: "overlay",
    label: "Ineinanderkopieren",
    // Componentwise: dark base multiplies, bright base screens. Expressed as
    // mask-weighted sum (mix() is typed float-t only, the mask here is a vec3).
    fn: (b, l) => {
      const dark = b.mul(l).mul(2.0);
      const light = oneMinus(oneMinus(b).mul(oneMinus(l)).mul(2.0));
      const mask = step(0.5, b);
      return dark.mul(oneMinus(mask)).add(light.mul(mask));
    },
  },
  { key: "add", label: "Addieren", fn: (b, l) => clamp(b.add(l), 0.0, 1.0) },
  { key: "difference", label: "Differenz", fn: (b, l) => abs(b.sub(l)) },
  { key: "darken", label: "Abdunkeln", fn: (b, l) => min(b, l) },
  { key: "lighten", label: "Aufhellen", fn: (b, l) => max(b, l) },
];

const byKey = new Map(BLEND_MODES.map((m) => [m.key, m]));
const keys: ReadonlySet<string> = new Set(BLEND_MODES.map((m) => m.key));

export function getBlend(key: BlendModeKey): BlendFn {
  const mode = byKey.get(key) ?? BLEND_MODES[0];
  if (!mode) {
    throw new Error("BLEND_MODES is empty");
  }
  return mode.fn;
}

export function isBlendMode(key: unknown): key is BlendModeKey {
  return typeof key === "string" && keys.has(key);
}
