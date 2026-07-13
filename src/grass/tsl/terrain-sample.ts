// ── Becoming Many — Grass Field Sampler ────────────────────────
//
// Reads the camera-centred field texture (R = absolute ground Y, G/B = terrain normal
// x/z, A = grass mask) at a world XZ. This REPLACES false-earth's analytic terrain
// (`terrainHelpers.getTerrainHeight/Normal`): becoming-many's terrain is CPU worldgen,
// so the CPU paints this texture and the GPU samples it here.
//
// Uses `textureLoad` (integer texel fetch, no sampler) + a manual bilinear lerp — this
// sidesteps the WebGPU `float32-filterable` adapter feature (linear filtering of an
// rgba32float texture isn't guaranteed on Metal/mobile) and stays deterministic on
// every backend. Sampling in a compute stage is legal (three emits `textureLoad`).

import {
  clamp,
  float,
  floor,
  int,
  ivec2,
  max,
  mix,
  normalize,
  oneMinus,
  sqrt,
  textureLoad,
  vec3,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import type { FloatNode, Vec2Node, Vec3Node } from "./nodes.ts";

export interface FieldSample {
  /** Absolute world ground height Y. */
  height: FloatNode;
  /** Unit terrain normal (y reconstructed from x/z). */
  normal: Vec3Node;
  /** Grass suitability 0..1. */
  mask: FloatNode;
}

/** Bilinear-sample the field texture at a world XZ. `origin` = texture min corner (world
 *  XZ), `size` = world coverage (m), `res` = texels per edge (compile-time). */
export function sampleField(
  tex: THREE.Texture,
  worldXZ: Vec2Node,
  origin: Vec2Node,
  size: FloatNode,
  res: number,
): FieldSample {
  const maxIdx = res - 1;
  const uvf = worldXZ.sub(origin).div(size); // 0..1 across the coverage
  const texel = uvf.mul(float(res)).sub(0.5); // pixel-centre convention
  const base = floor(texel);
  const f = texel.sub(base);

  // Clamp in float space (int nodes lack a `.clamp` method), then convert to int for
  // the integer texel fetch.
  const x0 = int(clamp(base.x, 0, maxIdx));
  const y0 = int(clamp(base.y, 0, maxIdx));
  const x1 = int(clamp(base.x.add(1), 0, maxIdx));
  const y1 = int(clamp(base.y.add(1), 0, maxIdx));

  const t00 = textureLoad(tex, ivec2(x0, y0));
  const t10 = textureLoad(tex, ivec2(x1, y0));
  const t01 = textureLoad(tex, ivec2(x0, y1));
  const t11 = textureLoad(tex, ivec2(x1, y1));

  const top = mix(t00, t10, f.x);
  const bot = mix(t01, t11, f.x);
  const s = mix(top, bot, f.y); // R=height, G=nx, B=nz, A=mask

  const nx = s.g;
  const nz = s.b;
  const ny = sqrt(max(float(0), oneMinus(nx.mul(nx).add(nz.mul(nz)))));

  return { height: s.r, normal: normalize(vec3(nx, ny, nz)), mask: s.a };
}
