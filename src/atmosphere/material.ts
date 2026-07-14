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
//     dust doesn't hang in the void past where the world itself fades). The mote is a
//     dark fleck wearing the sense's distance fog — near it stays dark, far it
//     dissolves into the haze colour, so under echo the dust is depth-true. Its
//     PRESENCE is per-sense too: `u.dustStrength` (a SENSE_PROFILES field) gates the
//     opacity, so a sense wanting a cleaner image can fade the whole field out.
//
// OPAQUE, NOT BLENDED — the VR-critical choice. Under the WebGPU WebXR path the
// *transparent* render pass does not present, so a blended dust field (which renders
// fine in flatscreen) vanishes in the headset while the opaque terrain shows. So the
// motes render in the OPAQUE pass instead: `alphaTest` discards the fragments outside
// the round dot (the shape survives with or without MSAA), and `alphaToCoverage` turns
// the remaining soft edge + the near/far/sense fades into MSAA coverage (a smooth,
// dithered partial-presence) when the target is multisampled. No `transparent = true`,
// so nothing depends on the XR transparent pass.
//
// The wrap centers on `atmo.playerPos` (fed from `signals.playerPose`); the near-eye
// fade instead uses `cameraPos` (the CPU-fed presenting-camera uniform), where the
// real head position is what matters — the flat rig pose would misplace the fade in VR.
//
// The mesh's model matrix is identity (group at scene origin), so the world-space
// `center` we assign as the local `positionNode` is also the world position.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  attribute,
  float,
  hash,
  instanceIndex,
  mix,
  mod,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";
// The near-eye fade uses the CPU-fed camera-position uniform, NOT the TSL
// `cameraPosition` node — that node doesn't resolve to the headset under the WebGPU
// WebXR path, which drops every mote inside its near-fade in VR. See camera-pos.ts.
import { cameraPos } from "../render/camera-pos.ts";
import type { KitUniforms } from "../render/uniforms.ts";
import type { AtmosphereUniforms } from "./uniforms.ts";

/** Box the motes fill, in metres: XZ span, vertical band, XZ span. Must match `dust.ts`. */
const BOX_X = 60;
const BOX_Y = 30;
const BOX_Z = 60;
/** Mote radius in metres — small specks, a touch bigger (jittered a little per instance). */
const MOTE_RADIUS = 0.08;
const TAU = 6.2831853;

/** Build the single material shared by every mote. */
export function createDustMaterial(u: KitUniforms, atmo: AtmosphereUniforms): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial();
  // Opaque pass (see header): the transparent pass does not present in WebGPU WebXR,
  // so blended dust vanishes in VR. `alphaTest` carves the round dot regardless of MSAA;
  // `alphaToCoverage` softens the edge + carries the fades as coverage when multisampled.
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  material.sizeAttenuation = true; // distant motes shrink naturally

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
  const dist = cameraPos.distance(center);
  const r = uv().sub(0.5).length().mul(2.0); // 0 at centre → 1 at edge
  const disc = smoothstep(float(1.0), float(0.0), r);
  const nearFade = smoothstep(float(1.5), float(6.0), dist); // invisible < 1.5 m
  const farFade = smoothstep(u.viewRadius, u.viewRadius.mul(0.55), dist);

  // The mote wears the sense's distance fog, like every world surface: a near speck
  // stays a dark fleck, a far one dissolves into the haze colour. Under echo this
  // makes the dust depth-TRUE — a mote at 100 m is exactly as pale as terrain at
  // 100 m — instead of a fixed black spot punching through the depth map.
  const fogT = dist.sub(u.fogNear).div(u.fogFar.sub(u.fogNear)).clamp(0.0, 1.0);
  material.colorNode = mix(vec3(0.0, 0.0, 0.0), u.fogColor, fogT);
  // `dustStrength` is the per-sense presence the SenseManager lerps — senses that
  // want a cleaner image can fade the whole field out. This alpha becomes MSAA coverage
  // (alphaToCoverage) and the alphaTest cutoff, so the fades read as a soft dither.
  material.opacityNode = disc.mul(nearFade).mul(farFade).mul(u.dustStrength).mul(float(0.9));

  return material;
}
