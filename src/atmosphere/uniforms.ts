// ── Becoming Many — Atmosphere Uniforms ────────────────────────
//
// Live TSL uniforms for the floating dust motes. Tiny: the wrap lattice needs to
// know where the player is (so the mote box follows locomotion), plus the virtual
// clock for the gentle breathing drift. Sole writer is `atmosphere.update`.
//
// `playerPos` is fed from `signals.playerPose` — NOT the TSL `cameraPosition` node —
// so the cloud is anchored to the rig's world locomotion (and doesn't jitter with VR
// head-bob). The billboard/projection in the material still uses the real per-eye
// camera matrices.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`.

import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/** Build the live atmosphere uniforms. */
export function createAtmosphereUniforms() {
  return {
    /** World position the mote lattice centers on. WRITER: atmosphere.update, from
     *  `signals.playerPose`. */
    playerPos: uniform(new THREE.Vector3()),
    /** Virtual elapsed seconds, mirroring `signals.time` (respects pause/seek/timeScale).
     *  WRITER: atmosphere.update. Drives the breathing drift only. */
    clock: uniform(0),
    /** Metres of gentle per-mote sway. 0 = perfectly still; small keeps dust "hanging". */
    driftStrength: uniform(0.08),
  };
}

export type AtmosphereUniforms = ReturnType<typeof createAtmosphereUniforms>;
