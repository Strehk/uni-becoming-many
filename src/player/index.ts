/**
 * Player — locomotion through the world.
 *
 * Flies forward at a constant speed, steered by a normalized `{ pitch, roll }` input
 * (e.g. from the ICAROS controller stream). The player owns a rig `Group` that carries
 * the camera; **move the rig, never the camera directly**. This is the WebXR pattern: a
 * presenting headset writes the camera's pose *within* the rig each frame, so flying the
 * rig composes cleanly with head tracking instead of fighting it.
 *
 * Convention (three.js): the rig looks down its local -Z, so "forward" is `translateZ` by a
 * negative amount. Pitch rotates about local X (climb/dive); roll turns about local Y.
 */
import * as THREE from "three/webgpu";

/** Normalized steering, each component in [-1, 1]. Zero input flies straight and level. */
export type Steering = Readonly<{ pitch: number; roll: number }>;

export type PlayerOptions = Readonly<{
  /** Constant forward speed, world units per second. */
  speed?: number;
  /** Climb/dive rate at full pitch deflection, radians per second. */
  pitchRate?: number;
  /** Turn rate at full roll deflection, radians per second. */
  yawRate?: number;
}>;

export interface Player {
  /** Rig carrying the camera. Add it to the scene; it is what moves through the world. */
  readonly rig: THREE.Group;
  /** Advance one frame: apply `input`, then fly forward `speed * dtSeconds`. */
  update(dtSeconds: number, input: Steering): void;
  /** Detach the camera and remove the rig from the scene graph. */
  dispose(): void;
}

/**
 * Create a player that carries `camera` and flies through the world.
 *
 * The camera is reparented into the rig at its current local offset (e.g. eye height), so
 * the rig's transform becomes the player's world pose.
 */
export function createPlayer(camera: THREE.Object3D, options: PlayerOptions = {}): Player {
  const speed = options.speed ?? 4;
  const pitchRate = options.pitchRate ?? 0.8;
  const yawRate = options.yawRate ?? 0.8;

  const rig = new THREE.Group();
  rig.name = "player-rig";
  rig.add(camera);

  function update(dtSeconds: number, input: Steering): void {
    if (dtSeconds <= 0) {
      return;
    }
    // Steer in the rig's local frame, then translate along the (now rotated) forward axis.
    rig.rotateX(input.pitch * pitchRate * dtSeconds);
    rig.rotateY(-input.roll * yawRate * dtSeconds); // bank right (roll > 0) turns right
    rig.translateZ(-speed * dtSeconds); // -Z is forward
  }

  function dispose(): void {
    rig.remove(camera);
    rig.removeFromParent();
  }

  return { rig, update, dispose };
}
