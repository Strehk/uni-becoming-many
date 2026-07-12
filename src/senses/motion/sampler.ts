// ── SENSE MODULE: Motion — animated vertex sampler ─────────────
//
// Ported from vogel_motion_sinn `module/AnimatedVertexSampler.js`. Walks an actor's
// mesh tree once, lets the emission profile decide which vertices emit (and how
// strongly), then samples those vertices every frame in ROOT space — so only local
// animation (wing flap, bone deform) produces motion, not world movement. Skinned
// meshes go through `applyBoneTransform`.

import * as THREE from "three/webgpu";
import { type EmissionProfile, createDefaultEmissionProfile } from "./emission-profiles.ts";
import type { MotionTarget } from "./target-adapters.ts";

const _box = new THREE.Box3();
const _vertex = new THREE.Vector3();
const _rootInverse = new THREE.Matrix4();
const _meshToRoot = new THREE.Matrix4();

export interface SamplerBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
}

interface VertexSource {
  compactIndex: Int32Array;
  emitMask: Uint8Array;
  mesh: THREE.Mesh;
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  skinned: boolean;
}

export class AnimatedVertexSampler {
  readonly object: THREE.Object3D;
  readonly className: string;
  vertexCount = 0;
  readonly intensityWeights: number[] = [];
  readonly expansionWeights: number[] = [];
  readonly bounds: SamplerBounds = { center: new THREE.Vector3(), size: new THREE.Vector3() };

  private readonly profile: EmissionProfile;
  private sources: VertexSource[] = [];

  constructor(target: MotionTarget) {
    this.object = target.object;
    this.className = target.className ?? "default";
    this.profile = target.emissionProfile ?? createDefaultEmissionProfile();
    this.prepare();
  }

  private prepare(): void {
    this.object.updateMatrixWorld(true);
    _box.setFromObject(this.object);
    _box.getCenter(this.bounds.center);
    _box.getSize(this.bounds.size);
    this.profile.reset?.();

    this.object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      const position = child.geometry.getAttribute("position");
      if (!position) {
        return;
      }

      const emitMask = new Uint8Array(position.count);
      const compactIndex = new Int32Array(position.count);
      compactIndex.fill(-1);

      for (let i = 0; i < position.count; i++) {
        _vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        const decision = this.profile.evaluate(_vertex, this.bounds, {
          mesh: child,
          vertexIndex: i,
          className: this.className,
        });
        if (!decision.emits) {
          continue;
        }
        emitMask[i] = 1;
        compactIndex[i] = this.vertexCount;
        this.intensityWeights.push(decision.intensityWeight ?? 1);
        this.expansionWeights.push(decision.expansionWeight ?? 1);
        this.vertexCount++;
      }

      this.sources.push({
        compactIndex,
        emitMask,
        mesh: child,
        position,
        skinned: child instanceof THREE.SkinnedMesh,
      });
    });
  }

  /** Write this actor's emitting vertices (root space) into `targetArray` at `offset`. */
  sample(targetArray: Float32Array, offset = 0): void {
    this.object.updateMatrixWorld(true);
    _rootInverse.copy(this.object.matrixWorld).invert();

    for (const source of this.sources) {
      _meshToRoot.multiplyMatrices(_rootInverse, source.mesh.matrixWorld);
      for (let i = 0; i < source.position.count; i++) {
        if (source.emitMask[i] === 0) {
          continue;
        }
        _vertex.fromBufferAttribute(source.position, i);
        if (source.skinned && source.mesh instanceof THREE.SkinnedMesh) {
          source.mesh.applyBoneTransform(i, _vertex);
        }
        _vertex.applyMatrix4(_meshToRoot);
        const compact = source.compactIndex[i] ?? -1;
        if (compact < 0) {
          continue;
        }
        const dst = (offset + compact) * 3;
        targetArray[dst] = _vertex.x;
        targetArray[dst + 1] = _vertex.y;
        targetArray[dst + 2] = _vertex.z;
      }
    }
  }

  dispose(): void {
    this.sources = [];
  }
}
