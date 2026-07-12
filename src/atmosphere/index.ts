// ── Becoming Many — Atmosphere ─────────────────────────────────
//
// createAtmosphere(opts) → Atmosphere: a field of stationary dust motes that hang in
// the air. As the player-rig flies through the world, near motes streak past and far
// ones barely move — the motion parallax makes self-motion pop.
//
// The motes sit on a fixed world lattice but the box that holds them wraps around the
// player (material.ts), so the effect fills the infinite streaming world with one
// small static buffer and one draw call.
//
// Wiring mirrors `src/life/index.ts`, minus the terrain hooks — atmosphere is a pure
// CONSUMER of the substrate: it `peek()`s `playerPose` and `time` each frame and
// writes neither. It shares the sense uniforms (`KitUniforms`) so it fades at the
// same view edge as terrain and flora.

import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import { signals } from "../signals/index.ts";
import { createDustMesh } from "./dust.ts";
import { createDustMaterial } from "./material.ts";
import { createAtmosphereUniforms } from "./uniforms.ts";

export interface CreateAtmosphereOptions {
  scene: THREE.Scene;
  /** The live sense uniforms — the same set terrain and flora wear. */
  uniforms: KitUniforms;
}

export interface Atmosphere {
  /** Parent of the dust mesh; added to the scene on creation. */
  readonly group: THREE.Group;
  /** Advance the uniforms one frame. Call in the CONSUME phase, after `world.update`. */
  update(dt: number): void;
  dispose(): void;
}

/** Create the dust field and add it to the scene. Synchronous — no assets to load. */
export function createAtmosphere(opts: CreateAtmosphereOptions): Atmosphere {
  const group = new THREE.Group();
  opts.scene.add(group);

  const atmo = createAtmosphereUniforms();
  const material = createDustMaterial(opts.uniforms, atmo);
  const mesh = createDustMesh(material);
  group.add(mesh);

  return {
    group,

    update(_dt: number): void {
      // peek() in the hot path — playerPose is mutated in place, so it is peek-only.
      const p = signals.playerPose.peek();
      atmo.playerPos.value.set(p.x, p.y, p.z); // centers the wrap on the player
      atmo.clock.value = signals.time.peek(); // virtual clock → drift respects the transport
    },

    dispose(): void {
      group.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
