// ── Becoming Many — Creatures substrate ────────────────────────
//
// The host-side actor layer the perception modules read from (MASTERPLAN §4, S7).
// The swarm/network prototypes deliberately ship NO creatures of their own — the
// host provides them:
//
//   - **boids bird flocks** (procedurally animated wing flap, terrain-aware).
//     Flocking follows the classic Reynolds model as implemented by
//     github.com/juanuys/boids: separation / alignment / cohesion against
//     flockmates, a WANDERING GOAL each flock seeks ("migratory urge" — a
//     waypoint re-rolled when reached), and a soft boundary that steers
//     far-strayed birds back. Several independent flocks roam a wide radius
//     around the player, so swarms drift near and far instead of orbiting the
//     camera. The `netzwerk` sense reads the birds as network nodes; the
//     `motion` sense samples their animated vertices — the meshes themselves
//     stay hidden (perception-only creatures).
//   - **mushroom spawn points** scattered on the terrain around the player (the
//     mycelium network's anchors). Re-anchored when the player flies on; a
//     `creatures:mushrooms-changed` bus event tells consumers to rebuild.
//
// Everything here is plain world state — no sense logic, no signal writes except
// the mushroom-change event. Visual senses subscribe to what they need.

import * as THREE from "three/webgpu";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";

// ── Flock layout ──
// Each flock roams its own distance RING around the player: one stays close
// enough that its motion trails are always experienceable, the others range far
// ("schön weit rumfliegen") and only sweep past now and then. All rings sit well
// inside the streamed-terrain window (keepRadius 3 × 256 m chunks) so `ground()`
// almost always answers.
const FLOCK_RINGS: readonly { min: number; max: number }[] = [
  { min: 35, max: 130 }, // the near flock — the one you meet
  { min: 50, max: 160 }, // a second near-ish flock so encounters stay frequent
  { min: 90, max: 200 },
  { min: 150, max: 280 }, // the far wanderers
];
const BIRDS_PER_FLOCK = 24;
/** A bird farther than its ring + this margin from the player is steered back
 *  hard (the juanuys boundary rule — there: outside the sphere, wander ×20). */
const BOUNDARY_MARGIN = 80;
/** A flock re-rolls its waypoint when its centroid gets this close to it… */
const WAYPOINT_REACHED = 40;
/** …or after this many seconds (a flock that fights headwind still moves on). */
const WAYPOINT_TIMEOUT = 35;

// ── Boids tuning (adapted from juanuys/boids to metres + our speeds) ──
const SEPARATION_RADIUS = 4;
const ALIGNMENT_RADIUS = 14;
const COHESION_RADIUS = 22;
const SEEK_WEIGHT = 0.9;
const MIN_SPEED = 5;
const MAX_SPEED = 13;
/** Acceleration clamp, m/s² (juanuys: maxForce = delta·5 against maxSpeed 5). */
const MAX_FORCE = 30;

const MIN_ALTITUDE = 8; // metres above ground
const MAX_ALTITUDE = 60;
const MUSHROOM_COUNT = 24;
const MUSHROOM_RADIUS = 90;
/** Re-scatter the mushrooms when the player is farther than this from their anchor. */
const MUSHROOM_REANCHOR = 110;

export type GroundSource = (x: number, z: number) => number | null;

export interface BirdActor {
  /** Root object — what the motion sense samples and the network reads. */
  readonly object: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

export interface Creatures {
  /** Scene parent of all bird meshes. */
  readonly group: THREE.Group;
  readonly birds: readonly BirdActor[];
  /** Mushroom positions (world space). Mutated on re-anchor; listen for the
   *  `creatures:mushrooms-changed` bus event to rebuild dependents. */
  readonly mushrooms: readonly THREE.Vector3[];
  /** Show/hide the bird meshes (the motion sense recommends hiding its sources). */
  setBirdsVisible(visible: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

interface Bird extends BirdActor {
  readonly leftWing: THREE.Mesh;
  readonly rightWing: THREE.Mesh;
  readonly flapPhase: number;
  readonly flapSpeed: number;
  /** Which flock this bird belongs to — neighbours are flock-internal. */
  readonly flock: number;
}

/** One flock's shared state: the wandering goal its members seek. */
interface Flock {
  readonly waypoint: THREE.Vector3;
  /** Seconds since the waypoint was rolled (drives the timeout re-roll). */
  age: number;
}

/** Low-poly bird: a body cone + two hinged wing plates (procedural flap = the
 *  local vertex motion the motion-particle sense feeds on). */
function buildBird(material: THREE.Material): {
  root: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
} {
  const root = new THREE.Group();

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), material);
  body.geometry.rotateX(Math.PI / 2); // point forward (−z → +z flight axis)
  root.add(body);

  const wingGeo = new THREE.PlaneGeometry(0.9, 0.34, 2, 1);
  wingGeo.translate(0.45, 0, 0); // hinge at the body edge

  const leftWing = new THREE.Mesh(wingGeo, material);
  leftWing.position.set(0.08, 0.02, 0);
  root.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, material);
  rightWing.position.set(-0.08, 0.02, 0);
  rightWing.rotation.y = Math.PI; // mirror
  root.add(rightWing);

  return { root, leftWing, rightWing };
}

export function createCreatures(scene: THREE.Scene, bus: Bus, ground: GroundSource): Creatures {
  const group = new THREE.Group();
  group.name = "creatures";
  // Creatures are perception-dependent: hidden in the white void by default, revealed
  // by whichever sense perceives them (the host toggles this via `setBirdsVisible`).
  group.visible = false;
  scene.add(group);

  const material = new THREE.MeshStandardNodeMaterial();
  material.color = new THREE.Color(0x2c3240);
  material.roughness = 0.9;
  material.side = THREE.DoubleSide;

  const pose = signals.playerPose.peek();

  // ── birds ──
  // A flock waypoint: somewhere in the flock's roam ring around the player, at
  // soaring altitude over the local terrain (player height as the fallback
  // while the chunk under it is still streaming).
  const rollWaypoint = (target: THREE.Vector3, ring: { min: number; max: number }): void => {
    const a = Math.random() * Math.PI * 2;
    const r = ring.min + Math.random() * (ring.max - ring.min);
    const x = pose.x + Math.cos(a) * r;
    const z = pose.z + Math.sin(a) * r;
    const g = ground(x, z);
    const y = (g ?? pose.y) + MIN_ALTITUDE + 10 + Math.random() * 25;
    target.set(x, y, z);
  };

  const flocks: Flock[] = [];
  const birds: Bird[] = [];
  for (const [f, ring] of FLOCK_RINGS.entries()) {
    const flock: Flock = { waypoint: new THREE.Vector3(), age: 0 };
    rollWaypoint(flock.waypoint, ring);
    flocks.push(flock);

    // The flock spawns as a loose cloud somewhere in its ring.
    const a = Math.random() * Math.PI * 2;
    const r = ring.min + Math.random() * (ring.max - ring.min) * 0.7;
    const cx = pose.x + Math.cos(a) * r;
    const cz = pose.z + Math.sin(a) * r;
    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      const { root, leftWing, rightWing } = buildBird(material);
      root.position.set(
        cx + (Math.random() - 0.5) * 24,
        pose.y + 14 + Math.random() * 22,
        cz + (Math.random() - 0.5) * 24,
      );
      group.add(root);
      birds.push({
        object: root,
        position: root.position,
        velocity: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(MIN_SPEED + 2),
        leftWing,
        rightWing,
        flapPhase: Math.random() * Math.PI * 2,
        flapSpeed: 7 + Math.random() * 3,
        flock: f,
      });
    }
  }

  // ── mushrooms ──
  const mushrooms: THREE.Vector3[] = [];
  let mushroomAnchor: { x: number; z: number } | null = null;

  const scatterMushrooms = (): boolean => {
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < MUSHROOM_COUNT * 2 && next.length < MUSHROOM_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.sqrt(Math.random()) * MUSHROOM_RADIUS;
      const x = pose.x + Math.cos(a) * r;
      const z = pose.z + Math.sin(a) * r;
      const y = ground(x, z);
      if (y === null) {
        continue;
      }
      next.push(new THREE.Vector3(x, y + 0.15, z));
    }
    if (next.length < 4) {
      return false; // terrain not streamed yet
    }
    mushrooms.length = 0;
    mushrooms.push(...next);
    mushroomAnchor = { x: pose.x, z: pose.z };
    bus.emit("creatures:mushrooms-changed");
    return true;
  };

  // Scratch vectors (no per-frame allocation).
  const centre = new THREE.Vector3();
  const steer = new THREE.Vector3();
  const diff = new THREE.Vector3();
  const align = new THREE.Vector3();

  let elapsed = 0;

  return {
    group,
    birds,
    mushrooms,
    setBirdsVisible(visible: boolean): void {
      // Toggle the whole group — the flock is on/off as one. The boids + wing flap
      // keep updating while hidden (motion samples the animation regardless), so the
      // trails / network still read live positions.
      group.visible = visible;
    },
    update(dt: number): void {
      if (dt <= 0) {
        return;
      }
      elapsed += dt;

      // Mushrooms: initial scatter + re-anchor when the player flew on.
      if (!mushroomAnchor) {
        scatterMushrooms();
      } else {
        const dx = pose.x - mushroomAnchor.x;
        const dz = pose.z - mushroomAnchor.z;
        if (dx * dx + dz * dz > MUSHROOM_REANCHOR * MUSHROOM_REANCHOR) {
          scatterMushrooms();
        }
      }

      // ── Flock goals: reached / stale / left-behind waypoints get re-rolled ──
      for (const [f, flock] of flocks.entries()) {
        const ring = FLOCK_RINGS[f];
        if (!ring) continue;
        flock.age += dt;

        centre.set(0, 0, 0);
        for (const b of birds) {
          if (b.flock === f) centre.add(b.position);
        }
        centre.divideScalar(BIRDS_PER_FLOCK);

        const reached = centre.distanceTo(flock.waypoint) < WAYPOINT_REACHED;
        const behind =
          (flock.waypoint.x - pose.x) ** 2 + (flock.waypoint.z - pose.z) ** 2 >
          (ring.max + 120) ** 2; // the player flew on — bring the route with them
        if (reached || behind || flock.age > WAYPOINT_TIMEOUT) {
          rollWaypoint(flock.waypoint, ring);
          flock.age = 0;
        }
      }

      for (const b of birds) {
        const flock = flocks[b.flock];
        if (!flock) continue;
        steer.set(0, 0, 0);

        // The three Reynolds rules against FLOCKmates (juanuys/boids ranges,
        // scaled to metres): separation < alignment < cohesion radius.
        centre.set(0, 0, 0);
        align.set(0, 0, 0);
        let cohesionCount = 0;
        let alignCount = 0;
        for (const o of birds) {
          if (o === b || o.flock !== b.flock) {
            continue;
          }
          diff.copy(b.position).sub(o.position);
          const d2 = diff.lengthSq();
          if (d2 < SEPARATION_RADIUS * SEPARATION_RADIUS && d2 > 0.0001) {
            steer.addScaledVector(diff, 10 / d2); // separation (inverse-square)
          }
          if (d2 < ALIGNMENT_RADIUS * ALIGNMENT_RADIUS) {
            align.add(o.velocity);
            alignCount++;
          }
          if (d2 < COHESION_RADIUS * COHESION_RADIUS) {
            centre.add(o.position);
            cohesionCount++;
          }
        }
        if (alignCount > 0) {
          align.divideScalar(alignCount).sub(b.velocity);
          steer.addScaledVector(align, 0.5); // match neighbours' heading
        }
        if (cohesionCount > 0) {
          centre.divideScalar(cohesionCount).sub(b.position);
          steer.addScaledVector(centre, 0.25); // toward local centre of mass
        }

        // Migratory urge: seek the flock's wandering waypoint.
        diff.copy(flock.waypoint).sub(b.position);
        const goalDist = diff.length();
        if (goalDist > 1) {
          steer.addScaledVector(diff.divideScalar(goalDist), SEEK_WEIGHT * MAX_SPEED * 0.35);
        }

        // Boundary (juanuys: outside the sphere the return urge dominates).
        const boundary = (FLOCK_RINGS[b.flock]?.max ?? 280) + BOUNDARY_MARGIN;
        diff.set(pose.x - b.position.x, 0, pose.z - b.position.z);
        const fromPlayer = diff.length();
        if (fromPlayer > boundary) {
          steer.addScaledVector(diff.normalize(), (fromPlayer - boundary) * 0.5);
        }

        // Terrain floor + altitude ceiling.
        const g = ground(b.position.x, b.position.z);
        if (g !== null) {
          const alt = b.position.y - g;
          if (alt < MIN_ALTITUDE) {
            steer.y += (MIN_ALTITUDE - alt) * 2.5;
          } else if (alt > MAX_ALTITUDE) {
            steer.y -= (alt - MAX_ALTITUDE) * 0.6;
          }
        }

        // Gentle wander so the flock never fully settles (juanuys wanderWeight 0.2).
        steer.x += Math.sin(elapsed * 0.7 + b.flapPhase * 3.1) * 0.8;
        steer.z += Math.cos(elapsed * 0.6 + b.flapPhase * 2.3) * 0.8;

        // Acceleration clamp, then integrate with min/max speed.
        const force = steer.length();
        if (force > MAX_FORCE) {
          steer.multiplyScalar(MAX_FORCE / force);
        }
        b.velocity.addScaledVector(steer, dt);
        const speed = b.velocity.length();
        const clamped = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
        if (speed > 0.001) {
          b.velocity.multiplyScalar(clamped / speed);
        }
        b.position.addScaledVector(b.velocity, dt);

        // Orient along the velocity; bank slightly into turns.
        b.object.lookAt(
          b.position.x + b.velocity.x,
          b.position.y + b.velocity.y,
          b.position.z + b.velocity.z,
        );

        // Wing flap — the local animation the motion sense perceives.
        const flap = Math.sin(elapsed * b.flapSpeed + b.flapPhase) * 0.85;
        b.leftWing.rotation.z = flap;
        b.rightWing.rotation.z = -flap;
      }
    },
    dispose(): void {
      group.removeFromParent();
      material.dispose();
      for (const b of birds) {
        b.leftWing.geometry.dispose();
        // right wing shares the geometry instance
        for (const child of b.object.children) {
          if (child instanceof THREE.Mesh && child !== b.leftWing && child !== b.rightWing) {
            child.geometry.dispose();
          }
        }
      }
    },
  };
}
