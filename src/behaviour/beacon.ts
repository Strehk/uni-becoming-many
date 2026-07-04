/**
 * Beacon — the modular payoff (docs §3.4, P5): a fully self-contained object instance whose
 * behaviour *emerges* from the substrate with zero central wiring.
 *
 * It touches all three access patterns exactly as the architecture intends:
 *   - **subscribe** (coarse): follows `signals.activeSense` to set its mood — echo makes it alert.
 *   - **peek** (hot path): reads `signals.playerPose` and the authored `signals.unrest` every frame.
 *   - **emit** (push): when alert AND the player is near AND a cooldown has elapsed AND a roll under
 *     `unrest` passes, it pushes `cue:chirp` onto the bus. It neither knows nor cares that the
 *     SoundDirector (or anyone) listens.
 *
 * Theatre set the macro (`unrest` rising toward the climax); signals carried the reactive state
 * (`activeSense`, `playerPose`); the beacon made the local decision. No conductor. Deleting it
 * leaves no dangling references — `dispose()` unsubscribes and removes its mesh.
 */
import { color, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import type { SenseId } from "../senses/index.ts";
import { bus, signals } from "../signals/index.ts";

export interface BeaconOptions {
  /** World position of the beacon. */
  position: { x: number; y: number; z: number };
  /** Radius within which the player counts as "near", in metres. Default 40. */
  radius?: number;
  /** The sense that makes this beacon alert. Default "echo". */
  activeSense?: SenseId;
  /** Minimum seconds between chirps. Default 0.6. */
  cooldown?: number;
  /** Emissive tint. Default a cool echo blue. */
  tint?: number;
}

export interface Beacon {
  update(dt: number): void;
  dispose(): void;
}

export function createBeacon(scene: THREE.Scene, options: BeaconOptions): Beacon {
  const radius = options.radius ?? 40;
  const wakingSense = options.activeSense ?? "echo";
  const cooldownTime = options.cooldown ?? 0.6;
  const tint = options.tint ?? 0x6fb0ff;

  // Glow uniform: the material reads it, we drive it from the beacon's emergent state.
  const glow = uniform(0.2);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = color(tint).mul(glow);
  material.transparent = true;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), material);
  mesh.position.set(options.position.x, options.position.y, options.position.z);
  mesh.frustumCulled = true;
  scene.add(mesh);

  // ── subscribe (coarse): mood follows the active sense ──
  let alert = signals.activeSense.peek() === wakingSense;
  const unsubscribe = signals.activeSense.subscribe((id) => {
    alert = id === wakingSense;
  });

  let cooldown = 0;
  let flash = 0; // decays after a chirp for a visible pulse

  const near = (): boolean => {
    const p = signals.playerPose.peek(); // hot-path read — no subscription
    const dx = p.x - options.position.x;
    const dz = p.z - options.position.z;
    return dx * dx + dz * dz <= radius * radius;
  };

  return {
    update(dt: number): void {
      cooldown = Math.max(0, cooldown - dt);
      flash = Math.max(0, flash - dt * 2.5);

      if (alert && cooldown === 0 && near()) {
        // Authored macro-envelope modulates how *likely* the chirp is (Theatre → unrest → here).
        const unrest = signals.unrest.peek();
        if (Math.random() < unrest) {
          bus.emit("cue:chirp", {
            x: options.position.x,
            y: options.position.y,
            z: options.position.z,
          });
          cooldown = cooldownTime;
          flash = 1;
        }
      }

      // Baseline breathing when alert, plus the post-chirp flash.
      const base = alert ? 0.5 + Math.sin(signals.time.peek() * 2) * 0.15 : 0.15;
      glow.value = base + flash;
    },
    dispose(): void {
      unsubscribe();
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
