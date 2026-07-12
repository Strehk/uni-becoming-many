// ── Shader senses — shared core uniforms ───────────────────────
//
// Ported from ShaderSinneModul `src/core/uniforms.js`.
//
//   uTime      — seconds on the time spine; `createShaderSenses().update()` copies
//                `signals.time` into it each frame (drives the echo ping etc.), so the
//                senses obey pause/seek/timeScale for free.
//   uBaseColor — the "paper colour" of the world all layers composite onto.
//                Default white: an empty layer stack ⇒ the pale void.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import { float, uniform } from "three/tsl";
import type { Node } from "three/webgpu";
import { Color } from "three/webgpu";

export const uTime = uniform(0);
export const uBaseColor = uniform(new Color("#ffffff"));

/** A scalar `uniform()` node (inferred so the node math methods survive). */
export function scalarUniform(value: number) {
  return uniform(value);
}
export type ScalarUniform = ReturnType<typeof scalarUniform>;

/** A colour `uniform()` node from a hex string / number. */
export function colorUniform(hex: string | number) {
  return uniform(new Color(hex));
}
export type ColorUniform = ReturnType<typeof colorUniform>;

/** Any live parameter uniform a sense exposes (dump/load + UI bind to these). */
export type ParamUniform = ScalarUniform | ColorUniform;

/** A float node, or a plain number a caller may pass through. */
export type FloatLike = number | Node<"float">;
/** An RGB value: a `vec3` expression or a colour uniform. */
export type Vec3Like = Node<"vec3"> | Node<"color">;

/** Number → float node; nodes pass through. */
export function F(x: FloatLike): Node<"float"> {
  return typeof x === "number" ? float(x) : x;
}
