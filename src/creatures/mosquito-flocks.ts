// ── Becoming Many — persistent ground-near mosquito fauna ─────

import {
  float,
  instancedBufferAttribute,
  positionView,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { FaunaConfig } from "../flora-fauna/config.ts";
import type { FloraLayerCompositor } from "../life/material.ts";
import { signals } from "../signals/index.ts";

const MAX_SWARMS = 48;
const MAX_PER_SWARM = 400;
export const MAX_FAUNA_MOSQUITOES = MAX_SWARMS * MAX_PER_SWARM;

// Like the modelled fauna, mosquito swarms occupy individual player-centred
// distance rings. Their entire envelope is lower and nearer than the flying
// bird/bat rings because mosquitoes remain a ground-near species.
const NEAR_RING = { min: 5, max: 18 };
const FAR_RING = { min: 35, max: 65 };
const REANCHOR_DISTANCE = 110;
const GROUND_HEIGHT = 0.9;
const BASE_RADIUS = 1.45;
const BASE_HEIGHT = 0.65;
const MIN_SPEED = 0.45;
const MAX_SPEED = 1.8;
const MAX_FORCE = 13;
const NEIGHBOUR_SAMPLES = 8;

type GroundSource = (x: number, z: number) => number | null;
type WaterSource = (x: number, z: number) => boolean;

interface Swarm {
  readonly start: number;
  readonly count: number;
  readonly anchor: THREE.Vector3;
}

export interface MosquitoFlocks {
  readonly maxPoints: number;
  readonly swarmCount: number;
  readonly count: number;
  readonly placed: boolean;
  getWorldPositions(): Float32Array;
  reconfigure(config: FaunaConfig): void;
  update(dt: number): void;
  dispose(): void;
}

const randomCount = (rawMin: number, rawMax: number): number => {
  const a = THREE.MathUtils.clamp(Math.round(rawMin), 1, MAX_PER_SWARM);
  const b = THREE.MathUtils.clamp(Math.round(rawMax), 1, MAX_PER_SWARM);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return min + Math.floor(Math.random() * (max - min + 1));
};

function signedNoise(index: number, channel: number, step: number): number {
  let hash =
    Math.imul(index + 1, 374761393) ^
    Math.imul(channel + 1, 668265263) ^
    Math.imul(step + 1, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x7fffffff - 1;
}

export function createMosquitoFlocks(
  parent: THREE.Object3D,
  ground: GroundSource,
  waterAt: WaterSource,
  initialConfig: FaunaConfig,
  layers?: FloraLayerCompositor,
): MosquitoFlocks {
  let config = structuredClone(initialConfig);
  let activeCount = 0;
  let activeWorldPositions = new Float32Array(0);
  const emptyWorldPositions = new Float32Array(0);
  let anchorsReady = false;
  let elapsed = 0;

  const localPositions = new Float32Array(MAX_FAUNA_MOSQUITOES * 3);
  const velocities = new Float32Array(MAX_FAUNA_MOSQUITOES * 3);
  const worldPositions = new Float32Array(MAX_FAUNA_MOSQUITOES * 3);
  const phases = new Float32Array(MAX_FAUNA_MOSQUITOES);
  const frequencies = new Float32Array(MAX_FAUNA_MOSQUITOES);
  const strengths = new Float32Array(MAX_FAUNA_MOSQUITOES);
  const swarms: Swarm[] = [];
  const anchorOrigin = new THREE.Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

  const positionAttribute = new THREE.InstancedBufferAttribute(worldPositions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.blending = THREE.NormalBlending;
  material.toneMapped = false;
  // Sprite geometry has no authored normal. Flat shading derives the correct
  // camera-facing normal from screen-space derivatives, so the shared thermal
  // shader can evaluate form without a missing-normal WebGPU warning.
  Object.assign(material, { flatShading: true });
  const instancePosition = instancedBufferAttribute<"vec3">(positionAttribute, "vec3");
  material.positionNode = instancePosition;
  const albedo = vec3(0.012, 0.014, 0.02);
  const rewireMaterial = (): void => {
    material.colorNode = layers
      ? layers.buildColorNode(
          {
            albedo,
            tempK: float(310),
            uvSignal: float(0),
            distance: positionView.z.negate(),
            light: float(1),
            // Mosquitoes use the existing warm-animal category. The instance
            // position is both sprite centre and thermal object centre.
            thermalBird: float(1),
            thermalObjectVariation: float(0),
            thermalCenter: instancePosition,
            thermalRadius: float(0.07),
          },
          albedo,
        )
      : albedo;
    material.needsUpdate = true;
  };
  rewireMaterial();
  const unsubscribeLayers = layers?.onStructureChange(rewireMaterial);
  material.opacityNode = smoothstep(0.5, 0.12, uv().sub(0.5).length()).mul(0.9);
  // Still reads as a tiny insect up close, but remains a visible particle at the
  // outer fauna ring instead of collapsing below one pixel almost immediately.
  material.scaleNode = uniform(0.07);

  const particles = new THREE.Sprite(material);
  particles.name = "fauna-mosquito-flocks";
  particles.count = 1;
  particles.visible = false;
  particles.frustumCulled = false;
  parent.add(particles);

  const pose = signals.playerPose.peek();

  const ringFor = (index: number, count: number): { min: number; max: number } => {
    const t = count <= 1 ? 0 : index / (count - 1);
    return {
      min: THREE.MathUtils.lerp(NEAR_RING.min, FAR_RING.min, t),
      max: THREE.MathUtils.lerp(NEAR_RING.max, FAR_RING.max, t),
    };
  };

  const rollAnchor = (index: number, count: number): THREE.Vector3 | null => {
    const ring = ringFor(index, count);
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = ring.min + Math.sqrt(Math.random()) * (ring.max - ring.min);
      const x = pose.x + Math.cos(angle) * radius;
      const z = pose.z + Math.sin(angle) * radius;
      const y = ground(x, z);
      if (y !== null && !waterAt(x, z)) {
        return new THREE.Vector3(x, y + GROUND_HEIGHT, z);
      }
    }
    return null;
  };

  const updateWorldPositions = (): void => {
    for (const swarm of swarms) {
      const terrainY = ground(swarm.anchor.x, swarm.anchor.z);
      if (terrainY !== null) {
        swarm.anchor.y = THREE.MathUtils.lerp(swarm.anchor.y, terrainY + GROUND_HEIGHT, 0.2);
      }
      for (let localIndex = 0; localIndex < swarm.count; localIndex++) {
        const mosquito = swarm.start + localIndex;
        const index = mosquito * 3;
        worldPositions[index] = swarm.anchor.x + (localPositions[index] ?? 0);
        worldPositions[index + 1] = swarm.anchor.y + (localPositions[index + 1] ?? 0);
        worldPositions[index + 2] = swarm.anchor.z + (localPositions[index + 2] ?? 0);
      }
    }
    positionAttribute.needsUpdate = true;
  };

  /** Transactional placement: until every swarm has real streamed ground, keep
   *  the particle draw hidden and retry on following frames. This avoids the old
   *  boot fallback that stacked all swarms at the uninitialised player origin. */
  const repositionSwarms = (): boolean => {
    const nextAnchors: THREE.Vector3[] = [];
    for (let index = 0; index < swarms.length; index++) {
      const next = rollAnchor(index, swarms.length);
      if (!next) return false;
      nextAnchors.push(next);
    }
    for (let index = 0; index < swarms.length; index++) {
      const swarm = swarms[index];
      const next = nextAnchors[index];
      if (!swarm || !next) return false;
      swarm.anchor.copy(next);
    }
    anchorsReady = true;
    anchorOrigin.set(pose.x, pose.z);
    updateWorldPositions();
    particles.visible = activeCount > 0;
    return true;
  };

  const rebuild = (): void => {
    swarms.length = 0;
    activeCount = 0;
    anchorsReady = false;
    particles.visible = false;
    const swarmCount = THREE.MathUtils.clamp(Math.round(config.mosquitoSwarmCount), 0, MAX_SWARMS);
    for (let flock = 0; flock < swarmCount; flock++) {
      const count = Math.min(
        randomCount(config.mosquitoMinPerSwarm, config.mosquitoMaxPerSwarm),
        MAX_FAUNA_MOSQUITOES - activeCount,
      );
      const swarm: Swarm = { start: activeCount, count, anchor: new THREE.Vector3() };
      swarms.push(swarm);

      for (let localIndex = 0; localIndex < count; localIndex++) {
        const mosquito = activeCount + localIndex;
        const index = mosquito * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * BASE_RADIUS * config.mosquitoSpread;
        localPositions[index] = Math.cos(angle) * radius;
        localPositions[index + 1] = (Math.random() * 2 - 1) * BASE_HEIGHT * config.mosquitoSpread;
        localPositions[index + 2] = Math.sin(angle) * radius;
        const velocityAngle = Math.random() * Math.PI * 2;
        const speed =
          (MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)) * config.mosquitoFlightSpeed;
        velocities[index] = Math.cos(velocityAngle) * speed;
        velocities[index + 1] = (Math.random() - 0.5) * speed;
        velocities[index + 2] = Math.sin(velocityAngle) * speed;
        phases[mosquito] = Math.random() * Math.PI * 2;
        frequencies[mosquito] = 12 + Math.random() * 16;
        strengths[mosquito] = 0.8 + Math.random() * 0.9;
      }
      activeCount += count;
    }
    activeWorldPositions = worldPositions.subarray(0, activeCount * 3);
    particles.count = Math.max(1, activeCount);
    anchorOrigin.set(pose.x, pose.z);
    if (activeCount > 0) repositionSwarms();
  };

  rebuild();

  return {
    maxPoints: MAX_FAUNA_MOSQUITOES,
    get swarmCount(): number {
      return anchorsReady ? swarms.length : 0;
    },
    get count(): number {
      return anchorsReady ? activeCount : 0;
    },
    get placed(): boolean {
      return anchorsReady;
    },
    getWorldPositions(): Float32Array {
      return anchorsReady ? activeWorldPositions : emptyWorldPositions;
    },
    reconfigure(next: FaunaConfig): void {
      const countsChanged =
        next.mosquitoSwarmCount !== config.mosquitoSwarmCount ||
        next.mosquitoMinPerSwarm !== config.mosquitoMinPerSwarm ||
        next.mosquitoMaxPerSwarm !== config.mosquitoMaxPerSwarm;
      config = structuredClone(next);
      if (countsChanged) rebuild();
    },
    update(dt: number): void {
      if (activeCount === 0) return;
      // Terrain streams after creatures are created. Placement therefore retries
      // independently of virtual time, just like ground-fauna reconciliation.
      if (!anchorsReady && !repositionSwarms()) return;
      const dx = pose.x - anchorOrigin.x;
      const dz = pose.z - anchorOrigin.y;
      if (dx * dx + dz * dz > REANCHOR_DISTANCE * REANCHOR_DISTANCE) {
        repositionSwarms();
      }
      if (dt <= 0) return;
      elapsed += dt;

      const spread = Math.max(0.1, config.mosquitoSpread);
      const radiusLimit = BASE_RADIUS * spread;
      const heightLimit = BASE_HEIGHT * spread;
      const speedScale = Math.max(0.05, config.mosquitoFlightSpeed);
      const minSpeed = MIN_SPEED * speedScale;
      const maxSpeed = MAX_SPEED * speedScale;
      const step = Math.min(dt, 0.05);

      for (const swarm of swarms) {
        for (let localIndex = 0; localIndex < swarm.count; localIndex++) {
          const mosquito = swarm.start + localIndex;
          const index = mosquito * 3;
          const px = localPositions[index] ?? 0;
          const py = localPositions[index + 1] ?? 0;
          const pz = localPositions[index + 2] ?? 0;
          const vx = velocities[index] ?? 0;
          const vy = velocities[index + 1] ?? 0;
          const vz = velocities[index + 2] ?? 0;
          const phase = phases[mosquito] ?? 0;
          const buzzTime = elapsed * (frequencies[mosquito] ?? 18) * speedScale + phase;
          const noiseStep = Math.floor(buzzTime * 1.25);
          const strength = strengths[mosquito] ?? 1;
          let ax = signedNoise(mosquito, 0, noiseStep) * 4.5 * strength;
          let ay = signedNoise(mosquito, 1, noiseStep) * 3.2 * strength - py * 0.8;
          let az = signedNoise(mosquito, 2, noiseStep) * 4.5 * strength;

          const samples = Math.min(NEIGHBOUR_SAMPLES, swarm.count - 1);
          for (let sample = 0; sample < samples; sample++) {
            const otherLocal = (localIndex + 1 + sample * 31) % swarm.count;
            const other = swarm.start + otherLocal;
            const otherIndex = other * 3;
            const ox = localPositions[otherIndex] ?? 0;
            const oy = localPositions[otherIndex + 1] ?? 0;
            const oz = localPositions[otherIndex + 2] ?? 0;
            const sx = px - ox;
            const sy = py - oy;
            const sz = pz - oz;
            const distanceSq = sx * sx + sy * sy + sz * sz;
            if (distanceSq < 0.025 && distanceSq > 0.000001) {
              const push = 0.025 / distanceSq;
              ax += sx * push;
              ay += sy * push;
              az += sz * push;
            }
            if (distanceSq < 0.8) {
              ax += (ox - px) * 0.025;
              ay += (oy - py) * 0.018;
              az += (oz - pz) * 0.025;
            }
          }

          const horizontalDistance = Math.hypot(px, pz);
          if (horizontalDistance > radiusLimit) {
            ax -= px * 4;
            az -= pz * 4;
          }
          if (Math.abs(py) > heightLimit) ay -= py * 5;

          const force = Math.hypot(ax, ay, az);
          if (force > MAX_FORCE) {
            const forceScale = MAX_FORCE / force;
            ax *= forceScale;
            ay *= forceScale;
            az *= forceScale;
          }
          let nextVx = vx + ax * step;
          let nextVy = vy + ay * step;
          let nextVz = vz + az * step;
          const speed = Math.hypot(nextVx, nextVy, nextVz);
          const targetSpeed = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
          if (speed > 0.0001) {
            const velocityScale = targetSpeed / speed;
            nextVx *= velocityScale;
            nextVy *= velocityScale;
            nextVz *= velocityScale;
          }
          const proposedY = py + nextVy * step;
          // The soft boids force shapes the cloud; this hard safety envelope is
          // what guarantees that numerical overshoot never sends a mosquito
          // below the terrain. The centre remains only 0.9 m above ground.
          const minLocalY = -GROUND_HEIGHT + 0.18;
          const nextY = THREE.MathUtils.clamp(proposedY, minLocalY, heightLimit);
          if (proposedY < minLocalY) nextVy = Math.abs(nextVy) * 0.35;
          else if (proposedY > heightLimit) nextVy = -Math.abs(nextVy) * 0.35;
          velocities[index] = nextVx;
          velocities[index + 1] = nextVy;
          velocities[index + 2] = nextVz;
          localPositions[index] = px + nextVx * step;
          localPositions[index + 1] = nextY;
          localPositions[index + 2] = pz + nextVz * step;
        }
      }
      updateWorldPositions();
    },
    dispose(): void {
      unsubscribeLayers?.();
      particles.removeFromParent();
      material.dispose();
    },
  };
}
