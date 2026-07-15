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
import { type EmissionProfile, createDefaultEmissionProfile } from "./emission-profiles.ts";
import {
  MOTION_POINT_SOURCE_REGISTER,
  MOTION_POINT_SOURCE_UNREGISTER,
  type MotionPointSource,
} from "./point-sources.ts";
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
  // maxParticles covers the whole flock set: 4 flocks × 24 birds × ~100 strided
  // verts of the rigged model × up to 40 lifetime frames (plain float buffers,
  // ~10 MB). particleSize 0.18: flocks roam far rings (35-280 m) — the ink-dark
  // trails must read clearly when a swarm passes at a hundred metres.
  const trail = new ParticleTrailBuffer(
    { lifetimeFrames: 14, particleSize: 0.18, motionGain: 8 },
    192_000,
  );
  group.add(trail.points);
  group.visible = false;
  scene.add(group);

  interface PointTrailEntry {
    readonly source: MotionPointSource;
    readonly trail: ParticleTrailBuffer;
    fadeFramesLeft: number;
  }
  const pointTrails = new Map<string, PointTrailEntry>();

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

  // The birds are the initial (and currently only) target class. The rigged
  // model carries ~300 vertices per bird (96 birds ≈ 28.5 k) — far denser than
  // the trail budget needs, so a stride keeps every third vertex before the
  // body-centre thinning applies. Trails stay per-bird continuous either way.
  const base = createDefaultEmissionProfile();
  const strided: EmissionProfile = {
    reset: () => base.reset?.(),
    evaluate(vertex, bounds, context) {
      if (context.vertexIndex % 3 !== 0) return { emits: false };
      return base.evaluate(vertex, bounds, context);
    },
  };
  const retargetBirds = (): void => {
    rebuildTargets([
      {
        className: "birds",
        emissionProfile: strided,
        objects: creatures.birds.map((b) => ({ object: b.object })),
      },
    ]);
  };
  retargetBirds();
  // The flock can be rebuilt at runtime (flora-fauna config): re-sample the new
  // bird meshes when it is (the mesh objects the samplers cached are now stale).
  const offBirds = bus.on("creatures:birds-changed", retargetBirds);

  const offPointRegister = bus.on(MOTION_POINT_SOURCE_REGISTER, (payload) => {
    const source = payload as Partial<MotionPointSource> | undefined;
    if (
      !source ||
      typeof source.id !== "string" ||
      typeof source.maxPoints !== "number" ||
      typeof source.getWorldPositions !== "function" ||
      typeof source.isActive !== "function"
    ) {
      return;
    }

    pointTrails.get(source.id)?.trail.dispose();
    const sizeScale = source.particleSizeScale ?? 1;
    const sourceTrail = new ParticleTrailBuffer(
      {
        lifetimeFrames: trail.lifetimeFrames,
        particleSize: trail.particleSize * sizeScale,
        expansionDistance: trail.expansionDistance,
        motionGain: trail.motionGain,
        fadePower: trail.fadePower,
        density: trail.density,
        opacity: trail.opacity,
      },
      Math.max(1, Math.ceil(source.maxPoints)) * 40,
    );
    group.add(sourceTrail.points);
    pointTrails.set(source.id, {
      source: source as MotionPointSource,
      trail: sourceTrail,
      fadeFramesLeft: 0,
    });
  });
  const offPointUnregister = bus.on(MOTION_POINT_SOURCE_UNREGISTER, (payload) => {
    const id = (payload as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string") return;
    pointTrails.get(id)?.trail.dispose();
    pointTrails.delete(id);
  });

  // Persistent fauna mosquitoes use the same world-point trail path as the
  // event swarm, but remain coupled to the global motion-sense signal.
  bus.emit(MOTION_POINT_SOURCE_REGISTER, {
    id: "fauna:mosquitoes",
    maxPoints: creatures.mosquitoes.maxPoints,
    particleSizeScale: 0.15,
    getWorldPositions: () => creatures.mosquitoes.getWorldPositions(),
    isActive: () => creatures.mosquitoes.count > 0,
  } satisfies MotionPointSource);

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
      for (const entry of pointTrails.values()) {
        entry.trail.setParticleSize(value * (entry.source.particleSizeScale ?? 1));
      }
    } else if (key === "motionGain") {
      trail.motionGain = value;
      for (const entry of pointTrails.values()) entry.trail.motionGain = value;
    } else if (key === "expansionDistance") {
      trail.expansionDistance = value;
      for (const entry of pointTrails.values()) entry.trail.expansionDistance = value;
    } else if (key === "fadePower") {
      trail.fadePower = value;
      for (const entry of pointTrails.values()) entry.trail.fadePower = value;
    } else if (key === "density") {
      trail.density = Math.min(1, Math.max(0, value));
      for (const entry of pointTrails.values()) entry.trail.density = trail.density;
    } else if (key === "lifetimeFrames") {
      trail.setLifetimeFrames(value);
      for (const entry of pointTrails.values()) entry.trail.setLifetimeFrames(value);
    } else if (key === "opacity") {
      trail.setOpacity(value);
      for (const entry of pointTrails.values()) entry.trail.setOpacity(value);
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
        {
          type: "range",
          key: "density",
          label: "Partikeldichte",
          min: 0.05,
          max: 1,
          step: 0.05,
          get: () => trail.density,
        },
        {
          type: "range",
          key: "lifetimeFrames",
          label: "Spur-Länge (Frames)",
          min: 2,
          max: 40,
          step: 1,
          digits: 0,
          get: () => trail.lifetimeFrames,
        },
        {
          type: "range",
          key: "opacity",
          label: "Deckkraft",
          min: 0.1,
          max: 2,
          step: 0.05,
          get: () => trail.opacity,
        },
      ],
    },
    update(): void {
      if (!totalVertexCount && pointTrails.size === 0) {
        return;
      }
      if (enabled && totalVertexCount) {
        let offset = 0;
        for (const sampler of samplers) {
          sampler.sample(sampledVertices, offset);
          offset += sampler.vertexCount;
        }
        trail.spawnFromSamples(sampledVertices, samplers, targets);
      } else if (!enabled && fadeFramesLeft > 0) {
        fadeFramesLeft--;
        if (totalVertexCount) trail.fadeOnly();
      }

      for (const entry of pointTrails.values()) {
        const canSpawn = enabled || entry.source.alwaysEnabled === true;
        if (canSpawn && entry.source.isActive()) {
          entry.trail.spawnFromWorldPoints(entry.source.getWorldPositions());
          entry.fadeFramesLeft = entry.trail.lifetimeFrames;
        } else if (entry.fadeFramesLeft > 0) {
          entry.trail.fadeOnly();
          entry.fadeFramesLeft--;
        }
      }

      const pointTrailVisible = Array.from(pointTrails.values()).some(
        (entry) =>
          (enabled || entry.source.alwaysEnabled === true) &&
          (entry.source.isActive() || entry.fadeFramesLeft > 0),
      );
      group.visible = enabled || fadeFramesLeft > 0 || pointTrailVisible;
    },
    dispose(): void {
      offSignal();
      offParams();
      offBirds();
      offPointRegister();
      offPointUnregister();
      for (const sampler of samplers) {
        sampler.dispose();
      }
      trail.dispose();
      for (const entry of pointTrails.values()) entry.trail.dispose();
      pointTrails.clear();
      group.removeFromParent();
    },
  };
}
