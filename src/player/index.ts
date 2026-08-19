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
 *     climb/descend; the controller stream leaves it identity and uses the Altitude rate above.
 *
 * The player owns a rig `Group` (heading + position) carrying a gimbal `Group` (pitch look)
 * carrying the camera; **move the rig, never the camera directly**. This is the WebXR pattern:
 * a presenting headset writes the camera's pose *within* the rig each frame, so flying the rig
 * composes cleanly with head tracking instead of fighting it. The gimbal is identity unless the
 * debug pitch is used, so VR is unaffected.
 *
 * Convention (three.js): the rig looks down its local -Z, so "forward" is negative Z. `update`
 * inverts both steering axes before using them (see the polarity note there), so on the glide
 * model positive pitch *descends* and positive roll turns *left*.
 */
import * as THREE from "three/webgpu";

/** Normalized steering, each component in [-1, 1]. Zero input flies straight and level. */
export type Steering = Readonly<{ pitch: number; roll: number }>;

/** How briskly the soft floor carries a low-flying rig back up, per second. */
const FLOOR_RECOVERY = 3.5;
/** The floor that is never crossed, whatever the dive — the camera stays out of the hill. */
const HARD_CLEARANCE = 0.8;

/** Ground clearance kept in free flight — just enough to stay out of the terrain. */
const FREE_CLEARANCE = 0.6;

/**
 * Steering plus optional flight modifiers. The extra fields are absent on the controller
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

/**
 * Free ("creative") flight intent — the configure mode's way of moving, produced by
 * `free-flight.ts`. Unlike {@link Locomotion} nothing here accumulates: the rig moves only while
 * an axis is held, and the view is aimed absolutely rather than integrated.
 */
export type FreeFlight = Readonly<{
  /** Along the view, -1..1 (forward positive). */
  forward: number;
  /** Level, across the view, -1..1 (right positive). */
  strafe: number;
  /** Straight up/down in world space, -1..1 (up positive). */
  lift: number;
  /** Yaw to apply this frame, radians (positive turns right). */
  yawDelta: number;
  /** Absolute view pitch, radians (positive looks up). */
  pitch: number;
  /** Speed multiplier on {@link PlayerOptions.freeSpeed}. */
  boost: number;
}>;

export type PlayerOptions = Readonly<{
  /** Constant forward speed, world units per second. */
  speed?: number;
  /** Base speed of free flight, world units per second. Defaults to 18. */
  freeSpeed?: number;
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
   * Ease the rig back up when it dips below `clearance`, instead of pinning it there. Off by
   * default: the authored flight keeps its hard floor. `setFloorFeel` turns it on for the
   * desktop mode, where skimming low would otherwise jolt over every ridge.
   */
  softFloor?: boolean;
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
   * Advance one frame of FREE flight (the configure mode's creative-style movement): aim the view
   * absolutely, then translate along it. Nothing carries between frames, and the airspace bounds
   * do not apply — only a hand's clearance keeps the camera out of the ground. Use this *instead*
   * of `update`/`look` for the frame; the two models must not both run.
   */
  flyFree(dtSeconds: number, input: FreeFlight): void;
  /**
   * Tilt the look gimbal to an absolute, non-accumulating pitch. `pitch` is normalized to
   * [-1, 1] (positive looks up); zero re-centers. Set every frame — the caller (e.g. the
   * spring-centered keyboard) owns the return-to-level.
   */
  look(pitch: number): void;
  /**
   * Retune how the flight sits over the ground. The piece's own flight — the headset, the
   * ICAROS rig — is authored to a fixed clearance and a hard floor, and that is the default;
   * only the desktop mode asks for something else (see main.ts), because a hand on WASD wants
   * to skim low without being knocked about by every ridge.
   */
  setFloorFeel(options: { clearance?: number; soften?: boolean }): void;
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
  const freeSpeed = options.freeSpeed ?? 18;
  const climbRate = options.climbRate ?? 4;
  const yawRate = options.yawRate ?? 0.8;
  const lookAngle = options.lookAngle ?? 0.7; // ~40° at full deflection
  const floor = options.floor;
  let clearance = options.clearance ?? 3;
  let softFloor = options.softFloor === true;
  let maxAltitude = options.maxAltitude ?? 200; // mutable: the Theatre timeline can retune it live

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
  const right = new THREE.Vector3(); // free flight only: level strafe axis
  // Yaw is always taken about world-up so the heading can never tip into a bank or roll, no
  // matter how the rig accumulates. (Constant, so declared once outside the hot path.)
  const worldUp = new THREE.Vector3(0, 1, 0);

  function update(dtSeconds: number, input: Locomotion): void {
    if (dtSeconds <= 0) {
      return;
    }
    // Steering polarity, fixed here rather than per source: the rig reads inverted on both axes
    // against the convention above, so pull-back/lean-left is flipped once, in the one place every
    // steering source (M5 rig, phone tilt, debug keyboard) passes through. The axes are not
    // swapped — pitch still owns altitude, roll still owns heading.
    const pitch = -input.pitch;
    const roll = -input.roll;

    // Heading: integrate the roll rate into the rig as a yaw about world-up, so the new course
    // persists (turn and come about) and the horizon stays level — never a bank or flip.
    rig.rotateOnWorldAxis(worldUp, -roll * yawRate * dtSeconds); // roll > 0 turns left (inverted)

    if (!input.paused) {
      // Fly along where we're actually looking = rig heading * gimbal pitch. (The rig's parent is
      // the scene, assumed unrotated, so the rig's local quaternion is its world one.) The rig
      // itself only ever yaws, so this forward is level unless the debug gimbal is pitched.
      worldQuat.copy(rig.quaternion).multiply(gimbal.quaternion);
      forward.set(0, 0, -1).applyQuaternion(worldQuat);
      rig.position.addScaledVector(forward, speed * (input.throttle ?? 1) * dtSeconds);
      // Altitude: pitch is a vertical rate — climb/descend straight up/down (positive = up)
      // without tilting the rig, so the view never pitches. The gained altitude persists.
      rig.position.y += pitch * climbRate * dtSeconds;
    }

    // Terrain bounds: keep the rig within the airspace — at least `clearance` above the ground
    // and at most `maxAltitude` above it. Runs even when paused so a chunk streaming in underfoot
    // still lifts us. A null floor means "no surface known here yet" — leave altitude untouched.
    applyBounds(dtSeconds);
  }

  function flyFree(dtSeconds: number, input: FreeFlight): void {
    if (dtSeconds <= 0) {
      return;
    }
    // Aiming: yaw still rides world-up (the horizon stays level here too), pitch is the gimbal set
    // absolutely — the input owns the angle, so there is nothing to spring back from.
    rig.rotateOnWorldAxis(worldUp, -input.yawDelta); // yawDelta > 0 turns right
    gimbal.rotation.x = input.pitch;

    // Travel: forward follows the gaze, strafe stays level (rig only, no pitch), lift is world-up.
    const step = freeSpeed * input.boost * dtSeconds;
    worldQuat.copy(rig.quaternion).multiply(gimbal.quaternion);
    forward.set(0, 0, -1).applyQuaternion(worldQuat);
    right.set(1, 0, 0).applyQuaternion(rig.quaternion);
    rig.position.addScaledVector(forward, input.forward * step);
    rig.position.addScaledVector(right, input.strafe * step);
    rig.position.y += input.lift * step;

    // Creative bounds: no ceiling at all, and only enough floor clearance that the camera never
    // ends up inside the terrain. Deliberately not `applyBounds` — being able to leave the
    // authored airspace is the point of this mode.
    if (floor) {
      const ground = floor(rig.position.x, rig.position.z);
      if (ground !== null && rig.position.y < ground + FREE_CLEARANCE) {
        rig.position.y = ground + FREE_CLEARANCE;
      }
    }
  }

  /**
   * Keep the rig in the airspace.
   *
   * By default the floor is HARD — the rig is set to `ground + clearance`, which is what the
   * authored flight expects. With `softFloor` on it is flown back in instead: below the line
   * the rig is eased up a few metres per second, which reads as the aircraft being carried by
   * the ground rather than stopped by it, and a low pass over rolling terrain stops jolting.
   * A hard limit still sits underneath, so no amount of diving puts the camera in the hill.
   */
  function applyBounds(dtSeconds: number): void {
    if (!floor) return;
    const ground = floor(rig.position.x, rig.position.z);
    if (ground === null) return;

    const min = ground + clearance;
    if (rig.position.y < min) {
      if (softFloor) {
        const ease = 1 - Math.exp(-FLOOR_RECOVERY * dtSeconds);
        rig.position.y += (min - rig.position.y) * ease;
        const hard = ground + HARD_CLEARANCE;
        if (rig.position.y < hard) rig.position.y = hard;
      } else {
        rig.position.y = min;
      }
    }
    const max = ground + maxAltitude;
    if (rig.position.y > max) rig.position.y = max;
  }

  function setFloorFeel(options: { clearance?: number; soften?: boolean }): void {
    if (options.clearance !== undefined) clearance = options.clearance;
    if (options.soften !== undefined) softFloor = options.soften;
  }

  function look(pitch: number): void {
    // Absolute — assigned, never accumulated — so the caller's spring back to 0 re-levels.
    gimbal.rotation.x = pitch * lookAngle;
  }

  function setMaxAltitude(metres: number): void {
    maxAltitude = metres; // takes effect on the next update()'s applyBounds() clamp
  }

  function dispose(): void {
    gimbal.remove(camera);
    rig.remove(gimbal);
    rig.removeFromParent();
  }

  return { rig, update, flyFree, look, setFloorFeel, setMaxAltitude, dispose };
}
