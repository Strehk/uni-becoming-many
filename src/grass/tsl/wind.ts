// ── Becoming Many — Grass Wind Field ───────────────────────────
//
// The world-space wind that drives per-blade facing in the compute: a scrolling
// fractal-noise strength field + a facing bias that turns blades to lean downwind.
// Ported from momentchan/false-earth `core/shaders/windHelpers.ts`.

import { atan, cos, float, mx_fractal_noise_float, remapClamp, sin } from "three/tsl";
import { safeNormalize2D } from "./blade.ts";
import type { FloatNode, Vec2Node } from "./nodes.ts";

const PI = Math.PI;
const TWO_PI = Math.PI * 2;

/** Wind strength 0..`windStrength` at a world XZ, scrolling along the wind direction. */
export function calculateWindStrength(
  worldXZ: Vec2Node,
  windDir: Vec2Node,
  windScale: FloatNode,
  time: FloatNode,
  windSpeed: FloatNode,
  windStrength: FloatNode,
): FloatNode {
  const dir = safeNormalize2D(windDir);
  const windUv = worldXZ.mul(windScale).add(dir.mul(time).mul(windSpeed));
  const n = mx_fractal_noise_float(windUv);
  return remapClamp(n, float(-1), float(1), float(0), windStrength);
}

/** Blend a blade's base angle toward the wind direction, normalized to [0, 1] turns. */
export function applyWindFacingAndNormalize(
  baseAngle: FloatNode,
  windStrength01: FloatNode,
  windDir: Vec2Node,
  windFacing: FloatNode,
): FloatNode {
  const windAngle = atan(windDir.y, windDir.x);
  const delta = windAngle.sub(baseAngle);
  const angleDiff = atan(sin(delta), cos(delta));
  const facingAngle = baseAngle.add(angleDiff.mul(windFacing.mul(windStrength01)));
  const normalized = atan(sin(facingAngle), cos(facingAngle));
  return normalized.add(float(PI)).div(float(TWO_PI));
}
