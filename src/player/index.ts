/**
 * Player — locomotion through the world.
 *
 * Flies forward at a constant speed along wherever it is looking. Steering rides on top in
 * three layers — the first two are the ICAROS flight model and both *persist*; the third is a
 * debug-keyboard convenience that springs back:
 *
 *   - **Heading** (`update`'s `roll`): an integrating *rate* — deflection yaws the rig about the
 *     world-up axis and the new heading persists after input returns to zero. This is how you
 *     turn and come about: curve while held, hold the new course on release. Because the yaw is
 *     taken about world-up (never a tilted local axis), the horizon stays level — the camera can
 *     never bank or roll upside down.
 *   - **Altitude** (`update`'s `pitch`): an integrating vertical *rate* — deflection climbs or
 *     descends (positive = up) and the altitude gained persists after input returns to zero.
 *     Pitch moves the rig straight up/down without tilting it, so travel stays level and the
 *     view never pitches with it. This is the ICAROS climb/descend.
 *   - **Pitch look** (`look`): an *absolute*, non-accumulating pitch of an inner gimbal.
 *     Deflection tilts the view — and therefore travel — up or down; zero re-centers. Nothing
 *     accumulates, so releasing springs back to level. The debug keyboard drives this for
 *     climb/descend; the ICAROS stream leaves it identity and uses the Altitude rate above.
 *
 * On top of those three there is a fourth, purely *visual* layer:
 *
 *   - **World tilt** (`setWorldTilt`): a constant pitch of an inner `tilt` node that sits between
 *     the gimbal and the camera. It rotates only how the world is *seen* — the whole scene
 *     (horizon included) appears pitched downward — and, crucially, is **excluded from the flight
 *     forward vector** (which is taken from `rig × gimbal` only), so travel stays perfectly level
 *     while the view is angled. Its purpose is neck comfort in prone (ICAROS) flight: pitching the
 *     view reference *up* means a relaxed, downward-hanging head re-levels the horizon, so you can
 *     see where you're going without craning your neck up. It is meant to be applied only while a
 *     headset is presenting (the caller gates it on `xr.isPresenting`); on the flat page it stays 0.
 *
 * The player owns a rig `Group` (heading + position) carrying a gimbal `Group` (pitch look)
 * carrying a `tilt` `Group` (world tilt) carrying the camera; **move the rig, never the camera
 * directly**. This is the WebXR pattern: a presenting headset writes the camera's pose *within*
 * the rig each frame, so flying the rig composes cleanly with head tracking instead of fighting
 * it. The gimbal is identity unless the debug pitch is used, and the tilt is identity unless the
 * world tilt is set, so plain VR is unaffected.
 *
 * Convention (three.js): the rig looks down its local -Z, so "forward" is negative Z. Positive
 * pitch climbs (raises altitude); positive roll turns right.
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
  /** Vertical climb/descend speed at full pitch deflection, world units per second. */
  climbRate?: number;
  /** Turn rate at full roll deflection, radians per second. */
  yawRate?: number;
  /** Pitch-look angle at full deflection, radians. Bounds how far `look` tilts travel. */
  lookAngle?: number;
  /**
   * Optional ground-floor query. Given the rig's world XZ, returns the terrain
   * height beneath it, or `null` when unknown (no chunk streamed in there yet) — in
   * which case no clamp is applied. When it returns a height, the rig is held at
   * least `clearance` above it, so the player can never sink into the terrain.
   */
  floor?: (x: number, z: number) => number | null;
  /** Metres to keep between the rig and the terrain floor. Defaults to 3. */
  clearance?: number;
  /**
   * Maximum altitude above the terrain floor, in metres. Caps how high pitch can climb, so the
   * player can never leave the world's airspace. Terrain-relative like `clearance` (and using the
   * same `floor` query), so the ceiling follows the ground; when the floor is unknown, no cap is
   * applied. Defaults to 200.
   */
  maxAltitude?: number;
}>;

export interface Player {
  /** Rig carrying the gimbal + camera. Add it to the scene; it is what moves through the world. */
  readonly rig: THREE.Group;
  /**
   * Advance one frame: yaw the heading by `roll`, then (unless paused) fly forward
   * `speed * throttle * dtSeconds` and climb/descend by `pitch * climbRate * dtSeconds`.
   */
  update(dtSeconds: number, input: Locomotion): void;
  /**
   * Tilt the look gimbal to an absolute, non-accumulating pitch. `pitch` is normalized to
   * [-1, 1] (positive looks up); zero re-centers. Set every frame — the caller (e.g. the
   * spring-centered keyboard) owns the return-to-level.
   */
  look(pitch: number): void;
  /**
   * Set the constant world tilt, in radians. A *visual-only* pitch of the view that leaves flight
   * untouched: positive tilts the rendered world (horizon included) **downward**, by pitching the
   * view reference up so a relaxed, downward-facing head sees a level horizon — easing neck strain
   * in prone flight. Absolute (assigned, not accumulated); 0 restores an untilted view. Set it
   * every frame from the gated source (e.g. `xr.isPresenting ? tilt : 0`) so it drops to 0 off-VR.
   */
  setWorldTilt(radians: number): void;
  /**
   * Retune the altitude ceiling at runtime, in metres above the terrain floor (see
   * {@link PlayerOptions.maxAltitude}). Lets an authored source (the Theatre timeline) shape the
   * ceiling over the piece; applied on the next `update`'s bounds clamp. Values are used as-is.
   */
  setMaxAltitude(metres: number): void;
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
  const climbRate = options.climbRate ?? 4;
  const yawRate = options.yawRate ?? 0.8;
  const lookAngle = options.lookAngle ?? 0.7; // ~40° at full deflection
  const floor = options.floor;
  const clearance = options.clearance ?? 3;
  let maxAltitude = options.maxAltitude ?? 200; // mutable: the Theatre timeline can retune it live

  const rig = new THREE.Group();
  rig.name = "player-rig";
  // Inner node for the absolute pitch look. Kept at the rig origin (not eye height) so it stays
  // identity in VR — the eye-height offset rides on the camera, where the headset overrides it.
  const gimbal = new THREE.Group();
  gimbal.name = "player-gimbal";
  rig.add(gimbal);
  // World tilt node: a visual-only pitch that sits *below* the gimbal, so it is not part of the
  // flight forward vector (`rig × gimbal`) and never steers travel. In VR the headset writes the
  // camera pose within this node, so the whole view — head tracking and all — rides the tilt.
  const tilt = new THREE.Group();
  tilt.name = "player-tilt";
  gimbal.add(tilt);
  tilt.add(camera);

  // Scratch objects: forward = rig heading composed with the gimbal pitch look, per frame.
  const worldQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  // Yaw is always taken about world-up so the heading can never tip into a bank or roll, no
  // matter how the rig accumulates. (Constant, so declared once outside the hot path.)
  const worldUp = new THREE.Vector3(0, 1, 0);

  function update(dtSeconds: number, input: Locomotion): void {
    if (dtSeconds <= 0) {
      return;
    }
    // Heading: integrate the roll rate into the rig as a yaw about world-up, so the new course
    // persists (turn and come about) and the horizon stays level — never a bank or flip.
    rig.rotateOnWorldAxis(worldUp, -input.roll * yawRate * dtSeconds); // roll > 0 turns right

    if (!input.paused) {
      // Fly along where we're actually looking = rig heading * gimbal pitch. (The rig's parent is
      // the scene, assumed unrotated, so the rig's local quaternion is its world one.) The rig
      // itself only ever yaws, so this forward is level unless the debug gimbal is pitched.
      worldQuat.copy(rig.quaternion).multiply(gimbal.quaternion);
      forward.set(0, 0, -1).applyQuaternion(worldQuat);
      rig.position.addScaledVector(forward, speed * (input.throttle ?? 1) * dtSeconds);
      // Altitude: pitch is a vertical rate — climb/descend straight up/down (positive = up)
      // without tilting the rig, so the view never pitches. The gained altitude persists.
      rig.position.y += input.pitch * climbRate * dtSeconds;
    }

    // Terrain bounds: keep the rig within the airspace — at least `clearance` above the ground
    // and at most `maxAltitude` above it. Runs even when paused so a chunk streaming in underfoot
    // still lifts us. A null floor means "no surface known here yet" — leave altitude untouched.
    applyBounds();
  }

  function applyBounds(): void {
    if (!floor) return;
    const ground = floor(rig.position.x, rig.position.z);
    if (ground === null) return;
    const min = ground + clearance;
    const max = ground + maxAltitude;
    if (rig.position.y < min) rig.position.y = min;
    else if (rig.position.y > max) rig.position.y = max;
  }

  function look(pitch: number): void {
    // Absolute — assigned, never accumulated — so the caller's spring back to 0 re-levels.
    gimbal.rotation.x = pitch * lookAngle;
  }

  function setWorldTilt(radians: number): void {
    // Positive pitches the view reference *up* (three.js +X, same sense as the gimbal's look),
    // which drops the rendered world — horizon and all — downward in the view. Excluded from the
    // forward vector above, so flight stays level while only the picture tilts.
    tilt.rotation.x = radians;
  }

  function setMaxAltitude(metres: number): void {
    maxAltitude = metres; // takes effect on the next update()'s applyBounds() clamp
  }

  function dispose(): void {
    tilt.remove(camera);
    gimbal.remove(tilt);
    rig.remove(gimbal);
    rig.removeFromParent();
  }

  return { rig, update, look, setWorldTilt, setMaxAltitude, dispose };
}
