// ── dump/load for flat parameter uniform maps ──────────────────
//
// Ported from ShaderSinneModul `src/core/paramTree.js`, narrowed to the flat
// `Record<string, ParamUniform>` shape the four senses actually use.
//
// dump(): uniform map → plain JSON object (colour uniforms as '#rrggbb').
// load(): plain object → uniform map. Unknown/missing fields are ignored so
//         older exports stay compatible.

import { Color } from "three/webgpu";
import type { ParamUniform } from "./uniforms.ts";

export type ParamsJson = Record<string, string | number>;

export function dumpParams(params: Record<string, ParamUniform>): ParamsJson {
  const out: ParamsJson = {};
  for (const [key, u] of Object.entries(params)) {
    const value: unknown = u.value;
    out[key] = value instanceof Color ? `#${value.getHexString()}` : Number(value);
  }
  return out;
}

export function loadParams(params: Record<string, ParamUniform>, data: unknown): void {
  if (typeof data !== "object" || data === null) {
    return;
  }
  const source: Record<string, unknown> = Object.fromEntries(Object.entries(data));
  for (const [key, u] of Object.entries(params)) {
    const incoming = source[key];
    if (incoming === undefined) {
      continue;
    }
    if (u.value instanceof Color) {
      if (typeof incoming === "string") {
        u.value.set(incoming);
      }
    } else if (typeof incoming === "number" && Number.isFinite(incoming)) {
      u.value = incoming;
    }
  }
}
