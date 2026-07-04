/**
 * Player — locomotion through the world.
 *
 * Flies forward at a constant speed along wherever it is looking. Two steering layers ride on
 * top, differing in whether they persist:
 *
 *   - **Heading** (`update`'s `Steering`): an integrating *rate* — deflection turns the rig and
 *     the new heading persists after input returns to zero. This is how you turn and come about:
 *     curve while held, hold the new course on release. It is also the ICAROS flight model.
 *   - **Pitch look** (`look`): an *absolute*, non-accumulating pitch of an inner gimbal.
 *     Deflection tilts the view — and therefore travel — up or down; zero re-centers. Nothing
 *     accumulates, so releasing springs back to level (you keep the altitude gained but don't
 *     stay pitched). The debug keyboard drives this for climb/descend.
 *
 * The player owns a rig `Group` (heading + position) carrying a gimbal `Group` (pitch look)
 * carrying the camera; **move the rig, never the camera directly**. This is the WebXR pattern:
 * a presenting headset writes the camera's pose *within* the rig each frame, so flying the rig
 * composes cleanly with head tracking instead of fighting it. The gimbal is identity unless the
 * debug pitch is used, so VR is unaffected.
 *
 * Convention (three.js): the rig looks down its local -Z, so "forward" is negative Z. Positive
 * pitch climbs; positive roll turns right.
 */
import * as THREE from "three/webgpu";

/** Normalized steering, each component in [-1, 1]. Zero input flies straight and level. */
export type Steering = Readonly<{ pitch: number; roll: number }>;

/**
 * Steering plus optional flight modifiers. The extra fields are absent on the ICAROS
 * orientation stream (which is pure `Steering`), so they default to "fly normally":
 * full throttle, not paused. The debug keyboard controls populate them.
 */
export type Locomotion = Steering &
  Readonly<{
    /** Multiplier on the constant forward speed (1 = base, 2 = double). Defaults to 1. */
    throttle?: number;
    /** When true, hold position this frame — steer but do not translate. Defaults to false. */
    paused?: boolean;
  }>;

export type PlayerOptions = Readonly<{
  /** Constant forward speed, world units per second. */
  speed?: number;
  /** Climb/dive rate at full pitch deflection, radians per second. */
  pitchRate?: number;
  /** Turn rate at full roll deflection, radians per second. */
  yawRate?: number;
  /** Pitch-look angle at full deflection, radians. Bounds how far `look` tilts travel. */
  lookAngle?: number;
}>;

export interface Player {
  /** Rig carrying the gimbal + camera. Add it to the scene; it is what moves through the world. */
  readonly rig: THREE.Group;
  /** Advance one frame: apply heading `input`, then fly forward `speed * throttle * dtSeconds`. */
  update(dtSeconds: number, input: Locomotion): void;
  /**
   * Tilt the look gimbal to an absolute, non-accumulating pitch. `pitch` is normalized to
   * [-1, 1] (positive looks up); zero re-centers. Set every frame — the caller (e.g. the
   * spring-centered keyboard) owns the return-to-level.
   */
  look(pitch: number): void;
  /** Detach the camera and remove the rig from the scene graph. */
  dispose(): void;
}

/**
 * Create a player that carries `camera` and flies through the world.
 *
 * The camera is reparented into the rig's gimbal at its current local offset (e.g. eye
 * height), so the rig's transform becomes the player's world pose.
 */
export function createPlayer(camera: THREE.Object3D, options: PlayerOptions = {}): Player {
  const speed = options.speed ?? 4;
  const pitchRate = options.pitchRate ?? 0.8;
  const yawRate = options.yawRate ?? 0.8;
  const lookAngle = options.lookAngle ?? 0.7; // ~40° at full deflection

  const rig = new THREE.Group();
  rig.name = "player-rig";
  // Inner node for the absolute pitch look. Kept at the rig origin (not eye height) so it stays
  // identity in VR — the eye-height offset rides on the camera, where the headset overrides it.
  const gimbal = new THREE.Group();
  gimbal.name = "player-gimbal";
  rig.add(gimbal);
  gimbal.add(camera);

  // Scratch objects: forward = rig heading composed with the gimbal pitch look, per frame.
  const worldQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();

  function update(dtSeconds: number, input: Locomotion): void {
    if (dtSeconds <= 0) {
      return;
    }
    // Heading: integrate the steering rate into the rig, so the new course persists — this is
    // what lets you turn and come about.
    rig.rotateX(input.pitch * pitchRate * dtSeconds);
    rig.rotateY(-input.roll * yawRate * dtSeconds); // roll > 0 turns right

    if (input.paused) {
      return;
    }
    // Fly along where we're actually looking = rig heading * gimbal pitch. (The rig's parent is
    // the scene, assumed unrotated, so the rig's local quaternion is its world one.)
    worldQuat.copy(rig.quaternion).multiply(gimbal.quaternion);
    forward.set(0, 0, -1).applyQuaternion(worldQuat);
    rig.position.addScaledVector(forward, speed * (input.throttle ?? 1) * dtSeconds);
  }

  function look(pitch: number): void {
    // Absolute — assigned, never accumulated — so the caller's spring back to 0 re-levels.
    gimbal.rotation.x = pitch * lookAngle;
  }

  function dispose(): void {
    gimbal.remove(camera);
    rig.remove(gimbal);
    rig.removeFromParent();
  }

  return { rig, update, look, dispose };
}
