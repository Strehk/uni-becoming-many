// ── SENSE MODULE: Motion — particle ring buffer ────────────────
//
// Ported from vogel_motion_sinn `module/ParticleTrailBuffer.js`. A preallocated
// ring buffer of `totalVertexCount × lifetimeFrames` particles: each frame writes
// one slot from the sampled vertices, older slots fade and drift outward from
// their actor's centre — motion trails without the meshes.
//
// Changed for WebGPU: `THREE.Points` + `PointsMaterial` (sizable GL points) became
// an instanced `THREE.Sprite` with per-instance buffer attributes and a TSL graph —
// world-sized, additive, collapsing to nothing as the colour fades.
//
// IMPORTANT: the buffers are CPU-written every frame, so they must be
// `InstancedBufferAttribute`s read via `instancedBufferAttribute(...)` — the
// classic dynamic-upload path (`needsUpdate` re-uploads). `instancedArray`
// storage buffers are for GPU-compute-owned state: their CPU `needsUpdate`
// upload stops after the initial one, which left every trail particle at the
// zeroed first upload (invisible) while the CPU arrays were perfectly correct.

import { instancedBufferAttribute, mix, smoothstep, uniform, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { AnimatedVertexSampler } from "./sampler.ts";
import type { MotionTarget } from "./target-adapters.ts";

const _vertex = new THREE.Vector3();
const _previous = new THREE.Vector3();
const _direction = new THREE.Vector3();

export interface TrailBufferOptions {
  lifetimeFrames?: number;
  /** Particle size in world metres. */
  particleSize?: number;
  expansionDistance?: number;
  motionGain?: number;
  fadePower?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class ParticleTrailBuffer {
  readonly points: THREE.Sprite;
  lifetimeFrames: number;
  expansionDistance: number;
  motionGain: number;
  fadePower: number;
  capacity = 0;

  private readonly material: THREE.SpriteNodeMaterial;
  private readonly sizeUniform: { value: number };
  private frame = 0;
  private totalVertexCount = 0;
  private readonly maxCapacity: number;
  private readonly positions: Float32Array;
  private readonly basePositions: Float32Array;
  private readonly expansionDirections: Float32Array;
  private readonly colors: Float32Array;
  private readonly spawnIntensities: Float32Array;
  private previousLocalPositions = new Float32Array(0);
  private previousReady = new Uint8Array(0);
  private readonly positionAttribute: THREE.InstancedBufferAttribute;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;

  constructor(options: TrailBufferOptions = {}, maxParticles = 16_000) {
    this.lifetimeFrames = Math.max(1, Math.round(options.lifetimeFrames ?? 12));
    this.expansionDistance = options.expansionDistance ?? 0.22;
    this.motionGain = options.motionGain ?? 26;
    this.fadePower = options.fadePower ?? 1.6;
    this.maxCapacity = maxParticles;

    this.positions = new Float32Array(maxParticles * 3);
    this.basePositions = new Float32Array(maxParticles * 3);
    this.expansionDirections = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    this.spawnIntensities = new Float32Array(maxParticles);

    // Dynamic per-instance attributes — CPU writes + `needsUpdate` every frame.
    this.positionAttribute = new THREE.InstancedBufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);

    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    // NORMAL blending, not additive: the motion trails must read against the
    // white void ground as much as against the dark sky. Additive white-ish
    // particles are mathematically invisible over white — the buffer's intensity
    // channel instead drives an indigo→pale-cyan ramp with real opacity, which
    // contrasts both backdrops.
    material.blending = THREE.NormalBlending;
    material.toneMapped = false;
    material.positionNode = instancedBufferAttribute<"vec3">(this.positionAttribute, "vec3");
    const color = vec3(instancedBufferAttribute<"vec3">(this.colorAttribute, "vec3"));
    const intensity = color.z.clamp(0, 1); // blue channel = raw intensity × fade
    material.colorNode = mix(vec3(0.16, 0.2, 0.55), vec3(0.62, 0.9, 1.0), intensity);
    // Soft round particle; fully faded particles collapse (no fill-rate waste).
    const d = uv().sub(0.5).length();
    const disc = smoothstep(0.5, 0.12, d);
    material.opacityNode = disc.mul(intensity.pow(0.7).mul(0.9));
    const luma = color.dot(vec3(0.4, 0.4, 0.4));
    // Live size uniform — the UI writes `.value`, no rebuild.
    const uSize = uniform(options.particleSize ?? 0.055);
    material.scaleNode = uSize.mul(smoothstep(0.002, 0.03, luma).mul(0.7).add(0.3));
    this.sizeUniform = uSize;
    this.material = material;

    this.points = new THREE.Sprite(material);
    this.points.count = 1;
    this.points.frustumCulled = false;
  }

  get particleSize(): number {
    return this.sizeUniform.value;
  }

  resize(totalVertexCount: number): void {
    this.totalVertexCount = totalVertexCount;
    this.capacity = Math.min(totalVertexCount * this.lifetimeFrames, this.maxCapacity);
    this.previousLocalPositions = new Float32Array(totalVertexCount * 3);
    this.previousReady = new Uint8Array(totalVertexCount);
    this.positions.fill(0);
    this.colors.fill(0);
    this.spawnIntensities.fill(0);
    this.points.count = Math.max(1, this.capacity);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  spawnFromSamples(
    sampledVertices: Float32Array,
    samplers: readonly AnimatedVertexSampler[],
    targets: readonly MotionTarget[],
  ): void {
    if (!this.totalVertexCount) {
      return;
    }
    const slot = this.frame % this.lifetimeFrames;
    const slotOffset = slot * this.totalVertexCount;
    let localOffset = 0;

    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const target = targets[targetIndex];
      const sampler = samplers[targetIndex];
      if (!target || !sampler) {
        continue;
      }
      const matrix = target.object.matrixWorld;
      const center = target.object.getWorldPosition(_previous);

      for (let i = 0; i < sampler.vertexCount; i++) {
        const localIndex = localOffset + i;
        const src = localIndex * 3;
        _vertex.set(
          sampledVertices[src] ?? 0,
          sampledVertices[src + 1] ?? 0,
          sampledVertices[src + 2] ?? 0,
        );

        const distance =
          this.previousReady[localIndex] === 1
            ? _vertex.distanceTo(
                _previous.set(
                  this.previousLocalPositions[src] ?? 0,
                  this.previousLocalPositions[src + 1] ?? 0,
                  this.previousLocalPositions[src + 2] ?? 0,
                ),
              )
            : 0;

        this.previousLocalPositions[src] = _vertex.x;
        this.previousLocalPositions[src + 1] = _vertex.y;
        this.previousLocalPositions[src + 2] = _vertex.z;
        this.previousReady[localIndex] = 1;

        _vertex.applyMatrix4(matrix);
        target.object.getWorldPosition(_previous); // restore centre (reused scratch)
        _direction.subVectors(_vertex, center).normalize();

        const particleIndex = slotOffset + localIndex;
        if (particleIndex >= this.maxCapacity) {
          continue;
        }
        const dst = particleIndex * 3;
        const weight = sampler.intensityWeights[i] ?? 1;
        const intensity = clamp(distance * this.motionGain, 0.04, 1) * weight;

        this.basePositions[dst] = _vertex.x;
        this.basePositions[dst + 1] = _vertex.y;
        this.basePositions[dst + 2] = _vertex.z;
        this.expansionDirections[dst] = _direction.x;
        this.expansionDirections[dst + 1] = _direction.y;
        this.expansionDirections[dst + 2] = _direction.z;
        this.spawnIntensities[particleIndex] = intensity;
      }
      localOffset += sampler.vertexCount;
    }

    this.updateTrailSlots(slot);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.frame++;
  }

  private updateTrailSlots(newestSlot: number): void {
    for (let slot = 0; slot < this.lifetimeFrames; slot++) {
      const age = (newestSlot - slot + this.lifetimeFrames) % this.lifetimeFrames;
      const normalizedAge = age / Math.max(1, this.lifetimeFrames - 1);
      const fade = (1 - normalizedAge) ** this.fadePower;
      const expansion = normalizedAge ** 1.25 * this.expansionDistance;
      const start = slot * this.totalVertexCount;
      const end = Math.min(start + this.totalVertexCount, this.maxCapacity);

      for (let i = start; i < end; i++) {
        const idx = i * 3;
        const intensity = (this.spawnIntensities[i] ?? 0) * fade;
        this.positions[idx] =
          (this.basePositions[idx] ?? 0) + (this.expansionDirections[idx] ?? 0) * expansion;
        this.positions[idx + 1] =
          (this.basePositions[idx + 1] ?? 0) + (this.expansionDirections[idx + 1] ?? 0) * expansion;
        this.positions[idx + 2] =
          (this.basePositions[idx + 2] ?? 0) + (this.expansionDirections[idx + 2] ?? 0) * expansion;
        this.colors[idx] = 0.82 * intensity;
        this.colors[idx + 1] = 0.92 * intensity;
        this.colors[idx + 2] = intensity;
      }
    }
  }

  /** Advance fades only (no new spawns) — the natural fade-out after disable. */
  fadeOnly(): void {
    if (!this.totalVertexCount) {
      return;
    }
    this.updateTrailSlots((this.frame - 1 + this.lifetimeFrames) % this.lifetimeFrames);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.frame++;
  }

  setParticleSize(size: number): void {
    this.sizeUniform.value = size;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.material.dispose();
  }
}
