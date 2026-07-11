// ── Becoming Many — TSL Surface Kit ────────────────────────────
//
// Reusable node helpers for any world-surface material — terrain, water, flora.
// Each is a camera-relative effect evaluated in world space, so it slots straight
// into a *NodeMaterial's colorNode / emissiveNode with no per-frame CPU work. They
// compose inline (plain functions returning node expressions) rather than as `Fn`
// subfunctions — same result, and it keeps the typed-node fluent chain intact.
//
// Neutral by design: this module belongs to no feature area, so `terrain`, `life`,
// and `senses` can all share one look without importing each other.
//
// Note on instancing: `positionWorld` is derived from `positionLocal` *after* a
// material's `positionNode` runs, and `instancedMesh()` has already folded the
// instance matrix into `positionLocal` by then. So every helper below works
// unchanged on an InstancedMesh — it sees the instanced (and swayed) world position.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, types
// from `three/webgpu`. No GLSL.

import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep } from "three/tsl";
import type { Node } from "three/webgpu";

/** A scalar node in [0, 1] (or a plain number the callers may pass through). */
type Scalar = Node<"float">;
/** An RGB colour: a `color` uniform or the `vec3` that colour math produces. */
type ColorNode = Node<"vec3"> | Node<"color">;

/**
 * Quantize `t` ∈ [0, 1] into `levels` discrete bands — the "papercut" depth cue.
 * Pass `levels` as a `uniform()` to tweak the band count live.
 */
export function depthBands(t: Scalar, levels: Scalar): Scalar {
  return t.clamp(0, 1).mul(levels).floor().div(levels);
}

/**
 * Fresnel-style edge term — bright at grazing angles, dark face-on. `power`
 * sharpens the falloff (higher = thinner, crisper rim).
 */
export function fresnelEdge(power: Scalar): Scalar {
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(viewDir).clamp(0, 1);
  return float(1).sub(facing).pow(power);
}

/**
 * Per-mode view-radius reveal — 1 within `radius`, fading to 0 across a
 * `softness`-wide band beyond it. Multiply into styling so newly revealed
 * geometry fades in at the bubble's edge.
 */
export function viewReveal(radius: Scalar, softness: Scalar): Scalar {
  const dist = cameraPosition.distance(positionWorld);
  return float(1).sub(smoothstep(radius.sub(softness), radius, dist));
}

/**
 * Distance fog — blend `fogColor` into `baseColor` from `near` to `far`.
 */
export function distanceFog(
  baseColor: ColorNode,
  fogColor: ColorNode,
  near: Scalar,
  far: Scalar,
): Node<"vec3"> {
  const dist = cameraPosition.distance(positionWorld);
  const f = dist.sub(near).div(far.sub(near)).clamp(0, 1);
  return mix(baseColor, fogColor, f);
}
