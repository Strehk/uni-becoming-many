// ── Becoming Many — Creatures substrate ────────────────────────
//
// The host-side actor layer the perception modules read from (MASTERPLAN §4, S7).
// The swarm/network prototypes deliberately ship NO creatures of their own — the
// host provides them:
//
//   - a **boids bird swarm** (procedurally animated wing flap, terrain-aware,
//     loosely tethered to the player). The `netzwerk` sense reads the birds as
//     network nodes; the `motion` sense samples their animated vertices.
//   - **mushroom spawn points** scattered on the terrain around the player (the
//     mycelium network's anchors). Re-anchored when the player flies on; a
//     `creatures:mushrooms-changed` bus event tells consumers to rebuild.
//
// Everything here is plain world state — no sense logic, no signal writes except
// the mushroom-change event. Visual senses subscribe to what they need.

import * as THREE from "three/webgpu";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";

const BIRD_COUNT = 28;
/** The swarm roams inside this radius around its tether (the player). */
const SWARM_RADIUS = 70;
const MIN_ALTITUDE = 8; // metres above ground
const MAX_ALTITUDE = 55;
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
  const birds: Bird[] = [];
  for (let i = 0; i < BIRD_COUNT; i++) {
    const { root, leftWing, rightWing } = buildBird(material);
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * (SWARM_RADIUS - 20);
    root.position.set(
      pose.x + Math.cos(a) * r,
      pose.y + 10 + Math.random() * 20,
      pose.z + Math.sin(a) * r,
    );
    group.add(root);
    birds.push({
      object: root,
      position: root.position,
      velocity: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(6),
      leftWing,
      rightWing,
      flapPhase: Math.random() * Math.PI * 2,
      flapSpeed: 7 + Math.random() * 3,
    });
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
  const tether = new THREE.Vector3();

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

      // Swarm centre (for cohesion).
      centre.set(0, 0, 0);
      for (const b of birds) {
        centre.add(b.position);
      }
      centre.divideScalar(birds.length);

      tether.set(pose.x, pose.y + 18, pose.z);

      for (const b of birds) {
        steer.set(0, 0, 0);

        // Cohesion toward the swarm centre.
        diff.copy(centre).sub(b.position);
        steer.addScaledVector(diff, 0.35);

        // Separation + alignment against near neighbours.
        for (const o of birds) {
          if (o === b) {
            continue;
          }
          diff.copy(b.position).sub(o.position);
          const d2 = diff.lengthSq();
          if (d2 < 16 && d2 > 0.0001) {
            steer.addScaledVector(diff, 6 / d2); // separation
          }
          if (d2 < 100) {
            steer.addScaledVector(o.velocity, 0.02); // alignment
          }
        }

        // Soft tether to the player (the swarm stays experienceable).
        diff.copy(tether).sub(b.position);
        const tetherDist = diff.length();
        if (tetherDist > SWARM_RADIUS) {
          steer.addScaledVector(diff.normalize(), (tetherDist - SWARM_RADIUS) * 0.4);
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

        // Gentle wander so the swarm never fully settles.
        steer.x += Math.sin(elapsed * 0.7 + b.flapPhase * 3.1) * 0.8;
        steer.z += Math.cos(elapsed * 0.6 + b.flapPhase * 2.3) * 0.8;

        b.velocity.addScaledVector(steer, dt);
        const speed = b.velocity.length();
        const clamped = Math.min(Math.max(speed, 4), 11);
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
