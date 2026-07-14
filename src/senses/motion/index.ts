// ── Motion sense — effect factory + signal coupling ────────────
//
// Ported from vogel_motion_sinn `module/createMotionParticleEffect.js` and wired
// onto the substrate. Only movement is visible: particles trail from the animated
// vertices of the bird swarm (creatures substrate) while the meshes themselves
// disappear — the module RECOMMENDS source visibility, the host applies it.
//
//   - `signals.sense.motion` switches the effect; on disable existing particles
//     fade out naturally for one lifetime, then updates stop (zero cost).
//   - `sense:param {id:"motion", key, value}` adjusts size / gain / expansion / fade.
//   - The trails sample in ROOT space, so only the wing flap (local animation)
//     lights up — world movement alone does not brighten particles, per the
//     prototype's confirmed design answers.

import * as THREE from "three/webgpu";
import type { Creatures } from "../../creatures/index.ts";
import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { AnimatedVertexSampler } from "./sampler.ts";
import { type MotionTarget, type MotionTargetGroup, normalizeTargets } from "./target-adapters.ts";
import { ParticleTrailBuffer } from "./trail-buffer.ts";

export {
  createDefaultEmissionProfile,
  createPassthroughEmissionProfile,
} from "./emission-profiles.ts";
export { AnimatedVertexSampler } from "./sampler.ts";
export { ParticleTrailBuffer } from "./trail-buffer.ts";
export type {
  MotionTarget,
  MotionTargetGroup,
  VisibilityRecommendation,
} from "./target-adapters.ts";

export interface MotionSense {
  readonly controls: SensePanelDescriptor;
  update(dt: number): void;
  dispose(): void;
}

export function createMotionSense(scene: THREE.Scene, bus: Bus, creatures: Creatures): MotionSense {
  const group = new THREE.Group();
  group.name = "motion-particle-effect";
  // maxParticles covers the whole flock set: 3 flocks × 24 birds × ~28 verts ×
  // 14 lifetime frames ≈ 28 k — sized with headroom (plain float buffers, ~1 MB).
  // particleSize 0.11: flocks now roam far rings (35-280 m) — trails must still
  // read as a shimmer when a swarm passes at a hundred metres.
  const trail = new ParticleTrailBuffer(
    { lifetimeFrames: 14, particleSize: 0.11, motionGain: 8 },
    48_000,
  );
  group.add(trail.points);
  group.visible = false;
  scene.add(group);

  let targets: MotionTarget[] = [];
  let samplers: AnimatedVertexSampler[] = [];
  let sampledVertices = new Float32Array(0);
  let totalVertexCount = 0;
  let enabled = false;
  let fadeFramesLeft = 0;

  const rebuildTargets = (groups: readonly MotionTargetGroup[]): void => {
    for (const sampler of samplers) {
      sampler.dispose();
    }
    targets = normalizeTargets(groups);
    samplers = targets.map((target) => new AnimatedVertexSampler(target));
    totalVertexCount = samplers.reduce((sum, sampler) => sum + sampler.vertexCount, 0);
    sampledVertices = new Float32Array(totalVertexCount * 3);
    trail.resize(totalVertexCount);
  };

  // The birds are the initial (and currently only) target class.
  rebuildTargets([
    { className: "birds", objects: creatures.birds.map((b) => ({ object: b.object })) },
  ]);

  const setEnabled = (next: boolean): void => {
    if (next === enabled) {
      return;
    }
    enabled = next;
    if (enabled) {
      group.visible = true;
      fadeFramesLeft = 0;
    } else {
      fadeFramesLeft = trail.lifetimeFrames; // let existing particles fade out
    }
    // The module only produces the trail effect; the HOST owns source (bird-mesh)
    // visibility — it hides the flock while motion is up and shows trails instead
    // (see main.ts). This keeps the "module recommends, host applies" boundary clean.
  };

  const offSignal = signals.sense.motion.subscribe((v) => setEnabled(v > 0.5));
  setEnabled(signals.sense.motion.peek() > 0.5);

  const offParams = bus.on("sense:param", (payload) => {
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = new Map<string, unknown>(Object.entries(payload));
    if (p.get("id") !== "motion") {
      return;
    }
    const key = p.get("key");
    const value = p.get("value");
    if (typeof key !== "string" || typeof value !== "number") {
      return;
    }
    if (key === "particleSize") {
      trail.setParticleSize(value);
    } else if (key === "motionGain") {
      trail.motionGain = value;
    } else if (key === "expansionDistance") {
      trail.expansionDistance = value;
    } else if (key === "fadePower") {
      trail.fadePower = value;
    }
  });

  return {
    controls: {
      key: "motion",
      description:
        "Bewegungssehen: nur Bewegung leuchtet. Partikel-Trails entstehen an den animierten Flügeln der Schwarmtiere; die Körper selbst verschwinden.",
      controls: [
        {
          type: "range",
          key: "particleSize",
          label: "Partikelgröße",
          min: 0.01,
          max: 0.6,
          step: 0.005,
          digits: 3,
          get: () => trail.particleSize,
        },
        {
          type: "range",
          key: "motionGain",
          label: "Bewegungs-Verstärkung",
          min: 1,
          max: 40,
          step: 0.5,
          digits: 1,
          get: () => trail.motionGain,
        },
        {
          type: "range",
          key: "expansionDistance",
          label: "Ausdehnung",
          min: 0,
          max: 1.5,
          step: 0.01,
          get: () => trail.expansionDistance,
        },
        {
          type: "range",
          key: "fadePower",
          label: "Ausblend-Kurve",
          min: 0.5,
          max: 4,
          step: 0.05,
          get: () => trail.fadePower,
        },
      ],
    },
    update(): void {
      if (!totalVertexCount) {
        return;
      }
      if (!enabled) {
        if (fadeFramesLeft > 0) {
          fadeFramesLeft--;
          trail.fadeOnly();
          if (fadeFramesLeft === 0) {
            group.visible = false;
          }
        }
        return;
      }
      let offset = 0;
      for (const sampler of samplers) {
        sampler.sample(sampledVertices, offset);
        offset += sampler.vertexCount;
      }
      trail.spawnFromSamples(sampledVertices, samplers, targets);
    },
    dispose(): void {
      offSignal();
      offParams();
      for (const sampler of samplers) {
        sampler.dispose();
      }
      trail.dispose();
      group.removeFromParent();
    },
  };
}
