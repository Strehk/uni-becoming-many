// ── Becoming Many — Dust Material ──────────────────────────────
//
// One SpriteNodeMaterial for the whole dust field. It does two things in TSL:
//
//  1. `positionNode` — the camera-relative WRAP. Each mote has a random `instanceSeed`
//     in [0, 1); scaled by BOX it is a base offset in [0, BOX). The nearest stationary
//     world-lattice point to the player `p` is
//         center = p + mod(base − p + b/2, b) − b/2
//     which keeps `center − base ≡ 0 (mod b)` (every mote sits on a FIXED world
//     lattice, so it reads as still air) while `center ∈ [p − b/2, p + b/2)` (the cloud
//     always wraps around the player, so the infinite streaming terrain never leaves it
//     behind). SpriteNodeMaterial treats `positionNode` as the sprite CENTER and
//     billboards + size-attenuates the quad around it in view space automatically —
//     per-eye, so VR stereo is correct with no hand-rolled billboard math.
//
//  2. `colorNode` / `opacityNode` — a soft round dot (from the quad `uv`), faded out
//     right at the eye (no in-your-face smear) and toward the sense's `viewRadius` (so
//     dust doesn't hang in the void past where the world itself fades). The colour is
//     a plain neutral fleck — subtle daylight dust, not tied to the sense mood.
//
// The wrap centers on `atmo.playerPos` (fed from `signals.playerPose`), NOT the TSL
// `cameraPosition` node. `cameraPosition` is still used for the near-eye fade, where
// the real head position is what matters.
//
// The mesh's model matrix is identity (group at scene origin), so the world-space
// `center` we assign as the local `positionNode` is also the world position.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  cameraPosition,
  float,
  hash,
  instanceIndex,
  mod,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { AtmosphereUniforms } from "./uniforms.ts";

/** Box the motes fill, in metres: XZ span, vertical band, XZ span. Must match `dust.ts`. */
const BOX_X = 60;
const BOX_Y = 30;
const BOX_Z = 60;
/** Mote radius in metres — tiny specks (jittered a little per instance). */
const MOTE_RADIUS = 0.05;
const TAU = 6.2831853;

/** Build the single material shared by every mote. */
export function createDustMaterial(u: KitUniforms, atmo: AtmosphereUniforms): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.depthWrite = false; // depthTest stays on → hills occlude motes behind them
  material.sizeAttenuation = true; // distant motes shrink naturally
  // Neutral blending: subtle daylight dust, not glowy specks (that would be AdditiveBlending).

  const box = vec3(BOX_X, BOX_Y, BOX_Z);
  const half = box.mul(0.5);

  // ── The wrap: seed → stationary world-lattice center around the player ──────
  const seed = attribute<"vec3">("instanceSeed", "vec3"); // [0, 1) per axis
  const base = seed.mul(box); // [0, BOX)
  const wrapped = mod(base.sub(atmo.playerPos).add(half), box).sub(half);
  const lattice = atmo.playerPos.add(wrapped);

  // Gentle per-mote breathing so the field isn't glassily static; the virtual clock
  // means a paused transport freezes it. Free per-instance randomness via `hash`.
  const phase = hash(instanceIndex).mul(TAU);
  const t = atmo.clock;
  const drift = vec3(
    sin(t.mul(0.5).add(phase)),
    sin(t.mul(0.35).add(phase.mul(1.7))),
    sin(t.mul(0.42).add(phase.mul(2.3))),
  ).mul(atmo.driftStrength);
  const center = lattice.add(drift);

  // SpriteNodeMaterial reads this as the billboard CENTER (local == world here).
  material.positionNode = center;
  // Per-instance size jitter (0.7×–1.3×) so the field doesn't read as one uniform dot size.
  material.scaleNode = float(MOTE_RADIUS).mul(hash(instanceIndex.add(101)).mul(0.6).add(0.7));

  // ── Look: soft round dot, faded near the eye and toward the sense edge ──────
  const dist = cameraPosition.distance(center);
  const r = uv().sub(0.5).length().mul(2.0); // 0 at centre → 1 at edge
  const disc = smoothstep(float(1.0), float(0.0), r);
  const nearFade = smoothstep(float(1.5), float(6.0), dist); // invisible < 1.5 m
  const farFade = smoothstep(u.viewRadius, u.viewRadius.mul(0.55), dist);

  material.colorNode = vec3(0.0, 0.0, 0.0); // black motes (NormalBlending darkens the backdrop)
  material.opacityNode = disc.mul(nearFade).mul(farFade).mul(float(0.8));

  return material;
}
