// ── The self-describing shader-sense module contract ───────────
//
// Ported from the ShaderSinneModul module shape: each sense is a factory returning a
// self-contained object — it carries its own uniforms (incl. `enabled`/`opacity`/
// `range`/`rangeSoft`), its UI metadata and its shader logic. A sense only ever reads
// the one `SenseSurface` field it perceives and returns a colour.

import type { Node } from "three/webgpu";
import type { BlendModeKey } from "./blend-modes.ts";
import type { SenseSurface } from "./surface.ts";
import type { ParamUniform, ScalarUniform } from "./uniforms.ts";

/** The four terrain-composited senses (a subset of the global SenseId set). */
export type ShaderSenseKey = "farben" | "echo" | "infrarot" | "uv";

export const SHADER_SENSE_KEYS: readonly ShaderSenseKey[] = ["farben", "echo", "infrarot", "uv"];

/** UI metadata a sense publishes for its specific parameters (rendered by any UI). */
export type SenseUiMeta =
  | {
      type: "range";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      digits?: number;
      hardMin?: number;
      hardMax?: number;
    }
  | { type: "color"; key: string; label: string }
  | { type: "check"; key: string; label: string }
  | {
      type: "presets";
      label: string;
      options: { label: string; values: Record<string, string> }[];
    };

export interface ShaderSense {
  key: ShaderSenseKey;
  label: string;
  description: string;
  /** Layer activation as a continuous uniform 0..1 — piece-by-piece layering without a
   *  shader recompile. Driven (eased) from `signals.sense[key]`. */
  enabled: ScalarUniform;
  /** User-facing layer opacity (multiplies with `enabled`). */
  opacity: ScalarUniform;
  /** Perception bubble: full effect up to `range` metres … */
  range: ScalarUniform;
  /** … then a soft fade-out band of this width behind it. */
  rangeSoft: ScalarUniform;
  /** Structural: changing it triggers a shader rebuild via the SenseSystem. */
  blendMode: BlendModeKey;
  /** Sense-specific live parameters (pure uniform writes, no recompile). */
  params: Record<string, ParamUniform>;
  /** UI metadata for `params`. */
  ui: SenseUiMeta[];
  /** Read the perceived field from the surface, return this sense's colour. */
  build(surface: SenseSurface): Node<"vec3">;
}
