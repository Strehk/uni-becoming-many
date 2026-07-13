// ── Becoming Many — Grass Blade Geometry Helpers ───────────────
//
// The blade's shape math: cubic bezier spine + tangent, per-type control points, and
// the slope-alignment / view-tilt / wind-push deformations the vertex shader applies.
// Ported from momentchan/false-earth `components/grass/core/shaderHelpers.ts` and its
// `packages/three-core` math (`bezier3`, `bezier3Tangent`, `safeNormalize2D`), which are
// NOT in that repo's tree — reimplemented here. Character-push + cosmic-wave paths dropped.

import {
  If,
  abs,
  acos,
  clamp,
  cos,
  cross,
  dot,
  float,
  fract,
  length,
  normalize,
  oneMinus,
  pow,
  select,
  sin,
  sqrt,
  vec2,
  vec3,
} from "three/tsl";
import type { FloatNode, Vec2Node, Vec3Node } from "./nodes.ts";

/** Cubic bezier point at parameter `t` ∈ [0,1]. */
export function bezier3(
  p0: Vec3Node,
  p1: Vec3Node,
  p2: Vec3Node,
  p3: Vec3Node,
  t: FloatNode,
): Vec3Node {
  const u = oneMinus(t);
  const uu = u.mul(u);
  return p0
    .mul(uu.mul(u))
    .add(p1.mul(uu.mul(t).mul(3)))
    .add(p2.mul(u.mul(t).mul(t).mul(3)))
    .add(p3.mul(t.mul(t).mul(t)));
}

/** Cubic bezier tangent (derivative) at `t`. */
export function bezier3Tangent(
  p0: Vec3Node,
  p1: Vec3Node,
  p2: Vec3Node,
  p3: Vec3Node,
  t: FloatNode,
): Vec3Node {
  const u = oneMinus(t);
  return p1
    .sub(p0)
    .mul(u.mul(u).mul(3))
    .add(p2.sub(p1).mul(u.mul(t).mul(6)))
    .add(p3.sub(p2).mul(t.mul(t).mul(3)));
}

/** Safely normalize a 2D vector; falls back to (1,0) for near-zero length. */
export function safeNormalize2D(v: Vec2Node): Vec2Node {
  const m2 = dot(v, v);
  return select(m2.greaterThan(float(1e-6)), v.mul(float(1).div(sqrt(m2))), vec2(1, 0));
}

/** Bezier control points p1/p2 for one of three blade archetypes (discreteType 0/1/2). */
export function getBezierControlPoints(
  discreteType: FloatNode,
  height: FloatNode,
  bend: FloatNode,
): { p1: Vec3Node; p2: Vec3Node } {
  const p1t0 = vec3(0, height.mul(0.4), bend.mul(0.5));
  const p2t0 = vec3(0, height.mul(0.75), bend.mul(0.7));
  const p1t1 = vec3(0, height.mul(0.35), bend.mul(0.6));
  const p2t1 = vec3(0, height.mul(0.7), bend.mul(0.8));
  const p1t2 = vec3(0, height.mul(0.3), bend.mul(0.7));
  const p2t2 = vec3(0, height.mul(0.65), bend.mul(1.0));

  const isType0 = discreteType.equal(float(0));
  const isType1 = discreteType.equal(float(1));
  const p1 = select(isType0, p1t0, select(isType1, p1t1, p1t2));
  const p2 = select(isType0, p2t0, select(isType1, p2t1, p2t2));
  return { p1, p2 };
}

/** Rotate `v` around unit-ish `axis` by `angle` radians (Rodrigues). */
export function rotateAxis(v: Vec3Node, axis: Vec3Node, angle: FloatNode): Vec3Node {
  const a = normalize(axis);
  const proj = a.mul(dot(a, v));
  return proj.add(v.sub(proj).mul(cos(angle))).add(cross(a, v).mul(sin(angle)));
}

/** Push bezier control points along the wind direction (tip pushed most). */
export function applyWindPush(
  windDir: Vec3Node,
  p1: Vec3Node,
  p2: Vec3Node,
  p3: Vec3Node,
  windStrength: FloatNode,
  height: FloatNode,
): { p1: Vec3Node; p2: Vec3Node; p3: Vec3Node } {
  const midPush1 = windStrength.mul(height).mul(0.08);
  const midPush2 = windStrength.mul(height).mul(0.15);
  const tipPush = windStrength.mul(height).mul(0.25);
  return {
    p1: p1.add(windDir.mul(midPush1)),
    p2: p2.add(windDir.mul(midPush2)),
    p3: p3.add(windDir.mul(tipPush)),
  };
}

/** Sin-like sway offset (side direction) that grows toward the tip — the wind flutter. */
export function vertexSwayOffset(
  windDir: Vec3Node,
  time: FloatNode,
  swayFreqMin: FloatNode,
  swayFreqMax: FloatNode,
  swayStrength: FloatNode,
  side: Vec3Node,
  t: FloatNode,
  height: FloatNode,
  windStrength: FloatNode,
  perBladeHash01: FloatNode,
  worldXZ: Vec2Node,
): Vec3Node {
  const topSwayMask = clamp(t.sub(0.5).mul(2), 0, 1);
  const windDir2 = vec2(windDir.x, windDir.z);
  const seed = fract(perBladeHash01.mul(3.567));
  const gust = float(0.65).add(float(0.35).mul(sin(time.mul(0.35).add(seed.mul(6.28318)))));
  const wave = dot(worldXZ, windDir2).mul(0.15);
  const baseFreq = swayFreqMin.add(swayFreqMax.sub(swayFreqMin).mul(seed));
  const phase = perBladeHash01.mul(6.28318).add(wave);
  const low = sin(time.mul(baseFreq).add(phase).add(t.mul(2.2)));
  const high = sin(time.mul(baseFreq.mul(5)).add(phase.mul(1.7)).add(t.mul(5)));
  const amp = height.mul(windStrength);
  const swayLow = amp.mul(gust).mul(swayStrength);
  const swayHigh = amp.mul(0.8).mul(swayStrength);
  const swayAmount = low.mul(swayLow).add(high.mul(swayHigh));
  return side.mul(swayAmount).mul(topSwayMask);
}

/** Align the blade's local up (0,1,0) to the terrain normal — rotates position + frame
 *  vectors in place. `lpos`/`tangent`/`side`/`normal` must be `.toVar()` vars. */
export function applySlopeAlignment(
  terrainNormal: Vec3Node,
  lpos: Vec3Node,
  tangent: Vec3Node,
  side: Vec3Node,
  normal: Vec3Node,
): void {
  const up = vec3(0, 1, 0);
  const axis = cross(up, terrainNormal);
  const dotProd = clamp(dot(up, terrainNormal), -1, 1);
  const angle = acos(dotProd);
  If(length(axis).greaterThan(float(0.001)), () => {
    const axisNorm = normalize(axis);
    lpos.assign(rotateAxis(lpos, axisNorm, angle));
    tangent.assign(rotateAxis(tangent, axisNorm, angle));
    side.assign(rotateAxis(side, axisNorm, angle));
    normal.assign(rotateAxis(normal, axisNorm, angle));
  });
}

/** View-dependent thickening so side-on blades don't vanish to a line. Returns the
 *  tilted local position. `side`/`normal` are already world-oriented (the grass group is
 *  translation-only, so no model-matrix transform is needed). `camDirW` = normalized
 *  camera→vertex-base direction in world space. */
export function applyViewDependentTilt(
  posObj: Vec3Node,
  side: Vec3Node,
  normal: Vec3Node,
  uvX: FloatNode,
  t: FloatNode,
  thicknessStrength: FloatNode,
  camDirW: Vec3Node,
): Vec3Node {
  const camDirLocalY = dot(camDirW, normalize(side));
  const edgeMask = uvX
    .sub(0.5)
    .mul(camDirLocalY)
    .mul(pow(abs(camDirLocalY), float(1.2)));
  const edgeMaskClamped = clamp(edgeMask, 0, 1);
  const centerMask = pow(oneMinus(t), float(0.5)).mul(pow(t.add(0.05), float(0.33)));
  const centerMaskClamped = clamp(centerMask, 0, 1);
  const tilt = thicknessStrength.mul(edgeMaskClamped).mul(centerMaskClamped);
  const normalXZ = normalize(vec3(normal.x, float(0), normal.z));
  return posObj.add(normalXZ.mul(tilt));
}
