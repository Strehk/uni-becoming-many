// ── Becoming Many — Event: mosquito particle swarm ─────────────

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { instancedBufferAttribute, smoothstep, uniform, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  MOTION_POINT_SOURCE_REGISTER,
  MOTION_POINT_SOURCE_UNREGISTER,
  type MotionPointSource,
} from "../../senses/motion/point-sources.ts";
import type { EventContext, EventDefinition, EventInstance } from "../types.ts";

const PATH_URL = "/events/mosquito_path_neu_neu_neu.glb";
const VIEW_DIRECTION_STRETCH = 0.5;
const LATERAL_VERTICAL_SCALE = 1.5;
const PATH_SPEED = 0.5;
const START_RIGHT_OFFSET = 2;
const START_BACK_OFFSET = 2;
const POINT_SOURCE_ID = "event:mosquitoSwarm";
const MOSQUITO_COUNT = 220;
const SWARM_RADIUS = 1.6;
const SWARM_HEIGHT = 0.7;
const MIN_INTERNAL_SPEED = 0.9;
const MAX_INTERNAL_SPEED = 2.8;
const MAX_INTERNAL_FORCE = 15;
const MIN_BUZZ_FREQUENCY = 14;
const MAX_BUZZ_FREQUENCY = 28;
const MIN_BUZZ_STRENGTH = 0.9;
const MAX_BUZZ_STRENGTH = 1.8;
const GROUND_CLEARANCE = 0.8;

const SEPARATION_RADIUS = 0.12;
const ALIGNMENT_RADIUS = 0.48;
const COHESION_RADIUS = 0.82;

interface PathTrack {
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly duration: number;
}

/** Stable stepped noise: abrupt enough for mosquito jitter without becoming
 * frame-rate-dependent or allocating random state in the hot loop. */
function signedBuzzNoise(index: number, channel: number, step: number): number {
  let hash =
    Math.imul(index + 1, 374761393) ^
    Math.imul(channel + 1, 668265263) ^
    Math.imul(step + 1, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x7fffffff - 1;
}

class MosquitoSwarmEvent implements EventInstance {
  private readonly root = new THREE.Group();
  private readonly positionSourceQuaternion = new THREE.Quaternion();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchParentQuaternion = new THREE.Quaternion();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly pathPoint = new THREE.Vector3();
  private readonly worldCenter = new THREE.Vector3();
  private readonly scratchPoint = new THREE.Vector3();
  private readonly localPositions = new Float32Array(MOSQUITO_COUNT * 3);
  private readonly velocities = new Float32Array(MOSQUITO_COUNT * 3);
  private readonly buzzPhases = new Float32Array(MOSQUITO_COUNT);
  private readonly buzzFrequencies = new Float32Array(MOSQUITO_COUNT);
  private readonly buzzStrengths = new Float32Array(MOSQUITO_COUNT);
  private readonly worldPositions = new Float32Array(MOSQUITO_COUNT * 3);
  private readonly positionAttribute = new THREE.InstancedBufferAttribute(this.worldPositions, 3);
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly particles: THREE.Sprite;
  private readonly pointSource: MotionPointSource;

  private path: PathTrack | null = null;
  private elapsed = 0;
  private pathElapsed = 0;
  private isPlaying = false;

  constructor(private readonly ctx: EventContext) {
    this.root.name = "event-mosquito-swarm";
    (this.ctx.parent ?? this.ctx.scene).add(this.root);

    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    this.material.blending = THREE.NormalBlending;
    this.material.toneMapped = false;
    this.material.positionNode = instancedBufferAttribute<"vec3">(this.positionAttribute, "vec3");
    this.material.colorNode = vec3(0.015, 0.018, 0.025);
    const disc = smoothstep(0.5, 0.12, uv().sub(0.5).length());
    this.material.opacityNode = disc.mul(0.92);
    this.material.scaleNode = uniform(0.035);

    this.particles = new THREE.Sprite(this.material);
    this.particles.name = "event-mosquito-swarm-particles";
    this.particles.count = MOSQUITO_COUNT;
    this.particles.frustumCulled = false;
    this.particles.visible = false;
    this.ctx.scene.add(this.particles);

    this.pointSource = {
      id: POINT_SOURCE_ID,
      maxPoints: MOSQUITO_COUNT,
      particleSizeScale: 0.22,
      alwaysEnabled: true,
      getWorldPositions: () => this.worldPositions,
      isActive: () => this.isPlaying,
    };
    this.ctx.bus.emit(MOTION_POINT_SOURCE_REGISTER, this.pointSource);
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(PATH_URL);
    const clip = gltf.animations.find((candidate) =>
      candidate.tracks.some((track) => track.name.endsWith(".position")),
    );
    const track = clip?.tracks.find((candidate) => candidate.name.endsWith(".position"));
    if (!clip || !track) {
      throw new Error("mosquito path has no animated position track");
    }
    const values = Float32Array.from(track.values);
    const startX = values[0] ?? 0;
    const startY = values[1] ?? 0;
    const startZ = values[2] ?? 0;
    for (let i = 0; i < values.length; i += 3) {
      values[i] = START_RIGHT_OFFSET + ((values[i] ?? startX) - startX) * LATERAL_VERTICAL_SCALE;
      values[i + 1] = startY + ((values[i + 1] ?? startY) - startY) * LATERAL_VERTICAL_SCALE;
      values[i + 2] =
        START_BACK_OFFSET + ((values[i + 2] ?? startZ) - startZ) * VIEW_DIRECTION_STRETCH;
    }
    this.path = {
      times: Float32Array.from(track.times),
      values,
      duration: clip.duration,
    };
  }

  trigger(): void {
    if (!this.path) return;
    this.anchorRootAtPlayer();
    this.resetBoids();
    this.elapsed = 0;
    this.pathElapsed = 0;
    this.isPlaying = true;
    this.updateWorldPositions();
    this.particles.visible = false;
  }

  update(dt: number): void {
    if (!this.isPlaying || !this.path || dt <= 0) return;
    this.elapsed += dt;
    this.pathElapsed = Math.min(this.pathElapsed + dt * PATH_SPEED, this.path.duration);
    this.syncPositionSource();
    this.samplePath(this.pathElapsed, this.pathPoint);
    this.updateBoids(dt);
    this.updateWorldPositions();
    this.particles.visible = false;

    if (this.pathElapsed >= this.path.duration) {
      this.isPlaying = false;
      this.particles.visible = false;
    }
  }

  dispose(): void {
    this.ctx.bus.emit(MOTION_POINT_SOURCE_UNREGISTER, { id: POINT_SOURCE_ID });
    this.root.removeFromParent();
    this.particles.removeFromParent();
    this.material.dispose();
  }

  private anchorRootAtPlayer(): void {
    if (this.ctx.positionSource) {
      this.positionSourceQuaternion.identity();
      this.ctx.anchor(this.scratchPosition, this.scratchQuaternion);
      this.scratchPoint.set(0, 0, -1).applyQuaternion(this.scratchQuaternion);
      this.scratchPoint.y = 0;
      if (this.scratchPoint.lengthSq() > 0.0001) {
        this.scratchPoint.normalize();
        this.positionSourceQuaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          this.scratchPoint,
        );
      }
      this.syncPositionSource();
      return;
    }

    this.ctx.anchor(this.root.position, this.root.quaternion);
  }

  /** Match BirdFlight's route anchoring: follow source translation in world
   * space while preserving the heading captured when the event started. */
  private syncPositionSource(): void {
    const source = this.ctx.positionSource;
    if (!source) return;

    source.updateWorldMatrix(true, false);
    source.getWorldPosition(this.root.position);
    this.root.quaternion.copy(this.positionSourceQuaternion);

    const parent = this.root.parent;
    if (parent && parent !== this.ctx.scene) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.root.position);
      parent.getWorldQuaternion(this.scratchParentQuaternion).invert();
      this.root.quaternion.copy(this.scratchParentQuaternion);
    }
  }

  private samplePath(time: number, target: THREE.Vector3): void {
    const path = this.path;
    if (!path || path.times.length === 0) {
      target.set(0, 0, 0);
      return;
    }
    if (time <= (path.times[0] ?? 0)) {
      target.fromArray(path.values, 0);
      return;
    }

    const lastIndex = path.times.length - 1;
    if (time >= (path.times[lastIndex] ?? 0)) {
      target.fromArray(path.values, lastIndex * 3);
      return;
    }
    for (let i = 0; i < lastIndex; i++) {
      const fromTime = path.times[i] ?? 0;
      const toTime = path.times[i + 1] ?? 0;
      if (time < fromTime || time > toTime) continue;
      const alpha = (time - fromTime) / Math.max(toTime - fromTime, 0.0001);
      target
        .fromArray(path.values, i * 3)
        .lerp(this.scratchPoint.fromArray(path.values, (i + 1) * 3), alpha);
      return;
    }
  }

  private resetBoids(): void {
    for (let i = 0; i < MOSQUITO_COUNT; i++) {
      const index = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * SWARM_RADIUS;
      this.localPositions[index] = Math.cos(angle) * radius;
      this.localPositions[index + 1] = (Math.random() * 2 - 1) * SWARM_HEIGHT;
      this.localPositions[index + 2] = Math.sin(angle) * radius;

      const velocityAngle = Math.random() * Math.PI * 2;
      const speed = MIN_INTERNAL_SPEED + Math.random() * (MAX_INTERNAL_SPEED - MIN_INTERNAL_SPEED);
      this.velocities[index] = Math.cos(velocityAngle) * speed;
      this.velocities[index + 1] = (Math.random() - 0.5) * speed;
      this.velocities[index + 2] = Math.sin(velocityAngle) * speed;
      this.buzzPhases[i] = Math.random() * Math.PI * 2;
      this.buzzFrequencies[i] =
        MIN_BUZZ_FREQUENCY + Math.random() * (MAX_BUZZ_FREQUENCY - MIN_BUZZ_FREQUENCY);
      this.buzzStrengths[i] =
        MIN_BUZZ_STRENGTH + Math.random() * (MAX_BUZZ_STRENGTH - MIN_BUZZ_STRENGTH);
    }
  }

  private updateBoids(dt: number): void {
    for (let i = 0; i < MOSQUITO_COUNT; i++) {
      const index = i * 3;
      const px = this.localPositions[index] ?? 0;
      const py = this.localPositions[index + 1] ?? 0;
      const pz = this.localPositions[index + 2] ?? 0;
      const vx = this.velocities[index] ?? 0;
      const vy = this.velocities[index + 1] ?? 0;
      const vz = this.velocities[index + 2] ?? 0;

      const buzzPhase = this.buzzPhases[i] ?? 0;
      const buzzFrequency = this.buzzFrequencies[i] ?? 12;
      const buzzStrength = this.buzzStrengths[i] ?? 1;
      const buzzTime = this.elapsed * buzzFrequency + buzzPhase;
      const jitterStep = Math.floor(buzzTime * 1.35);
      const burstStep = Math.floor(this.elapsed * 5 + buzzPhase);
      const burst = 0.75 + (signedBuzzNoise(i, 3, burstStep) + 1) * 0.5;
      const jitterX = signedBuzzNoise(i, 0, jitterStep) * 4.5 * buzzStrength * burst;
      const jitterY = signedBuzzNoise(i, 1, jitterStep) * 3.2 * buzzStrength * burst;
      const jitterZ = signedBuzzNoise(i, 2, jitterStep) * 4.5 * buzzStrength * burst;
      let ax =
        (Math.sin(buzzTime) + Math.sin(buzzTime * 2.31 + buzzPhase * 0.7) * 0.45) *
          2.2 *
          buzzStrength +
        jitterX;
      let ay =
        (Math.cos(buzzTime * 1.47 + buzzPhase * 1.3) + Math.sin(buzzTime * 2.83) * 0.35) *
          1.4 *
          buzzStrength -
        py * 0.65 +
        jitterY;
      let az =
        (Math.sin(buzzTime * 1.83 + buzzPhase * 0.4) + Math.cos(buzzTime * 2.57) * 0.45) *
          2.2 *
          buzzStrength +
        jitterZ;
      let alignX = 0;
      let alignY = 0;
      let alignZ = 0;
      let centerX = 0;
      let centerY = 0;
      let centerZ = 0;
      let alignCount = 0;
      let cohesionCount = 0;

      for (let j = 0; j < MOSQUITO_COUNT; j++) {
        if (i === j) continue;
        const other = j * 3;
        const dx = px - (this.localPositions[other] ?? 0);
        const dy = py - (this.localPositions[other + 1] ?? 0);
        const dz = pz - (this.localPositions[other + 2] ?? 0);
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < SEPARATION_RADIUS * SEPARATION_RADIUS && distanceSq > 0.000001) {
          const push = 0.018 / distanceSq;
          ax += dx * push;
          ay += dy * push;
          az += dz * push;
        }
        if (distanceSq < ALIGNMENT_RADIUS * ALIGNMENT_RADIUS) {
          alignX += this.velocities[other] ?? 0;
          alignY += this.velocities[other + 1] ?? 0;
          alignZ += this.velocities[other + 2] ?? 0;
          alignCount++;
        }
        if (distanceSq < COHESION_RADIUS * COHESION_RADIUS) {
          centerX += this.localPositions[other] ?? 0;
          centerY += this.localPositions[other + 1] ?? 0;
          centerZ += this.localPositions[other + 2] ?? 0;
          cohesionCount++;
        }
      }

      if (alignCount > 0) {
        ax += (alignX / alignCount - vx) * 0.55;
        ay += (alignY / alignCount - vy) * 0.55;
        az += (alignZ / alignCount - vz) * 0.55;
      }
      if (cohesionCount > 0) {
        ax += (centerX / cohesionCount - px) * 0.9;
        ay += (centerY / cohesionCount - py) * 0.9;
        az += (centerZ / cohesionCount - pz) * 0.9;
      }

      const horizontalDistance = Math.hypot(px, pz);
      if (horizontalDistance > SWARM_RADIUS) {
        ax -= px * 2.4;
        az -= pz * 2.4;
      }
      if (Math.abs(py) > SWARM_HEIGHT) {
        ay -= py * 3;
      }

      const force = Math.hypot(ax, ay, az);
      if (force > MAX_INTERNAL_FORCE) {
        const forceScale = MAX_INTERNAL_FORCE / force;
        ax *= forceScale;
        ay *= forceScale;
        az *= forceScale;
      }

      let nextVx = vx + ax * dt;
      let nextVy = vy + ay * dt;
      let nextVz = vz + az * dt;
      const speed = Math.hypot(nextVx, nextVy, nextVz);
      const targetSpeed = THREE.MathUtils.clamp(speed, MIN_INTERNAL_SPEED, MAX_INTERNAL_SPEED);
      if (speed > 0.0001) {
        const speedScale = targetSpeed / speed;
        nextVx *= speedScale;
        nextVy *= speedScale;
        nextVz *= speedScale;
      }
      this.velocities[index] = nextVx;
      this.velocities[index + 1] = nextVy;
      this.velocities[index + 2] = nextVz;
      this.localPositions[index] = px + nextVx * dt;
      this.localPositions[index + 1] = py + nextVy * dt;
      this.localPositions[index + 2] = pz + nextVz * dt;
    }
  }

  private updateWorldPositions(): void {
    this.root.updateWorldMatrix(true, false);
    this.worldCenter.copy(this.pathPoint);
    this.root.localToWorld(this.worldCenter);
    const unclampedCenterY = this.worldCenter.y;
    const terrainY = this.ctx.ground?.(this.worldCenter.x, this.worldCenter.z);
    if (terrainY !== null && terrainY !== undefined) {
      this.worldCenter.y = Math.max(this.worldCenter.y, terrainY + GROUND_CLEARANCE + SWARM_HEIGHT);
    }
    const terrainLift = this.worldCenter.y - unclampedCenterY;

    for (let i = 0; i < MOSQUITO_COUNT; i++) {
      const index = i * 3;
      this.scratchPoint.fromArray(this.localPositions, index).add(this.pathPoint);
      this.root.localToWorld(this.scratchPoint);
      this.scratchPoint.y += terrainLift;
      this.worldPositions[index] = this.scratchPoint.x;
      this.worldPositions[index + 1] = this.scratchPoint.y;
      this.worldPositions[index + 2] = this.scratchPoint.z;
    }
    this.positionAttribute.needsUpdate = true;
  }
}

export const mosquitoSwarmEvent: EventDefinition = {
  id: "mosquitoSwarm",
  label: "Mückenschwarm",
  create(ctx: EventContext): EventInstance {
    return new MosquitoSwarmEvent(ctx);
  },
};
