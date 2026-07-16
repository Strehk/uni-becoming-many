// ── Becoming Many — persistent ground-near mosquito fauna ─────

import { instancedBufferAttribute, smoothstep, uniform, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { FaunaConfig } from "../flora-fauna/config.ts";
import { signals } from "../signals/index.ts";

const MAX_SWARMS = 48;
const MAX_PER_SWARM = 400;
export const MAX_FAUNA_MOSQUITOES = MAX_SWARMS * MAX_PER_SWARM;

const ANCHOR_MIN_RADIUS = 12;
const ANCHOR_MAX_RADIUS = 85;
const REANCHOR_DISTANCE = 110;
const GROUND_HEIGHT = 0.9;
const BASE_RADIUS = 1.45;
const BASE_HEIGHT = 0.65;
const MIN_SPEED = 0.45;
const MAX_SPEED = 1.8;
const MAX_FORCE = 13;
const NEIGHBOUR_SAMPLES = 8;

type GroundSource = (x: number, z: number) => number | null;

interface Swarm {
  readonly start: number;
  readonly count: number;
  readonly anchor: THREE.Vector3;
}

export interface MosquitoFlocks {
  readonly maxPoints: number;
  readonly count: number;
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
  initialConfig: FaunaConfig,
): MosquitoFlocks {
  let config = structuredClone(initialConfig);
  let activeCount = 0;
  let activeWorldPositions = new Float32Array(0);
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
  material.positionNode = instancedBufferAttribute<"vec3">(positionAttribute, "vec3");
  material.colorNode = vec3(0.012, 0.014, 0.02);
  material.opacityNode = smoothstep(0.5, 0.12, uv().sub(0.5).length()).mul(0.9);
  material.scaleNode = uniform(0.026);

  const particles = new THREE.Sprite(material);
  particles.name = "fauna-mosquito-flocks";
  particles.count = 1;
  particles.visible = false;
  particles.frustumCulled = false;
  parent.add(particles);

  const pose = signals.playerPose.peek();

  const rollAnchor = (target: THREE.Vector3): void => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius =
        ANCHOR_MIN_RADIUS + Math.sqrt(Math.random()) * (ANCHOR_MAX_RADIUS - ANCHOR_MIN_RADIUS);
      const x = pose.x + Math.cos(angle) * radius;
      const z = pose.z + Math.sin(angle) * radius;
      const y = ground(x, z);
      if (y !== null) {
        target.set(x, y + GROUND_HEIGHT, z);
        return;
      }
    }
    target.set(pose.x, (ground(pose.x, pose.z) ?? pose.y) + GROUND_HEIGHT, pose.z);
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

  const repositionSwarms = (): void => {
    for (const swarm of swarms) rollAnchor(swarm.anchor);
    anchorOrigin.set(pose.x, pose.z);
    updateWorldPositions();
  };

  const rebuild = (): void => {
    swarms.length = 0;
    activeCount = 0;
    const swarmCount = THREE.MathUtils.clamp(Math.round(config.mosquitoSwarmCount), 0, MAX_SWARMS);
    for (let flock = 0; flock < swarmCount; flock++) {
      const count = Math.min(
        randomCount(config.mosquitoMinPerSwarm, config.mosquitoMaxPerSwarm),
        MAX_FAUNA_MOSQUITOES - activeCount,
      );
      const swarm: Swarm = { start: activeCount, count, anchor: new THREE.Vector3() };
      rollAnchor(swarm.anchor);
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
    particles.visible = activeCount > 0;
    anchorOrigin.set(pose.x, pose.z);
    updateWorldPositions();
  };

  rebuild();

  return {
    maxPoints: MAX_FAUNA_MOSQUITOES,
    get count(): number {
      return activeCount;
    },
    getWorldPositions(): Float32Array {
      return activeWorldPositions;
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
      if (dt <= 0 || activeCount === 0) return;
      elapsed += dt;
      const dx = pose.x - anchorOrigin.x;
      const dz = pose.z - anchorOrigin.y;
      if (dx * dx + dz * dz > REANCHOR_DISTANCE * REANCHOR_DISTANCE) {
        repositionSwarms();
      }

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
          velocities[index] = nextVx;
          velocities[index + 1] = nextVy;
          velocities[index + 2] = nextVz;
          localPositions[index] = px + nextVx * step;
          localPositions[index + 1] = py + nextVy * step;
          localPositions[index + 2] = pz + nextVz * step;
        }
      }
      updateWorldPositions();
    },
    dispose(): void {
      particles.removeFromParent();
      material.dispose();
    },
  };
}
