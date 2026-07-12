// ── SENSE MODULE: Motion — per-model emission profiles ─────────
//
// Ported from vogel_motion_sinn `module/emissionProfiles.js`. A profile decides,
// per vertex, whether it emits particles and with which intensity/expansion weight —
// the model-dependent replacement for the lab's hardcoded bird body/head heuristic.

import type * as THREE from "three/webgpu";
import type { SamplerBounds } from "./sampler.ts";

export interface EmissionDecision {
  emits: boolean;
  intensityWeight?: number;
  expansionWeight?: number;
}

export interface EmissionProfile {
  reset?(): void;
  evaluate(
    vertex: THREE.Vector3,
    bounds: SamplerBounds,
    context: { mesh: THREE.Mesh; vertexIndex: number; className: string },
  ): EmissionDecision;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface DefaultEmissionOptions {
  /** Lateral half-width (fraction of the bounds) counted as "body centre". */
  centerHalfWidth?: number;
  /** Only every Nth centre vertex emits. */
  centerEmitStride?: number;
  /** Intensity weight at the very centre. */
  centerIntensity?: number;
}

/** Body-centre reduction: centre vertices emit sparsely and darker (bird-like). */
export function createDefaultEmissionProfile(
  options: DefaultEmissionOptions = {},
): EmissionProfile {
  const centerHalfWidth = options.centerHalfWidth ?? 0.24;
  const centerEmitStride = Math.max(1, Math.round(options.centerEmitStride ?? 5));
  const centerIntensity = options.centerIntensity ?? 0.12;
  let centerIndex = 0;

  return {
    reset(): void {
      centerIndex = 0;
    },
    evaluate(vertex, bounds): EmissionDecision {
      const halfWidth = Math.max(bounds.size.x * centerHalfWidth, 0.0001);
      const lateralDistance = Math.abs(vertex.x - bounds.center.x);
      const centerAmount = 1 - clamp(lateralDistance / halfWidth, 0, 1);
      const isCenter = centerAmount > 0.12;
      const emits = !isCenter || centerIndex % centerEmitStride === 0;
      if (isCenter) {
        centerIndex++;
      }
      return {
        emits,
        intensityWeight: emits ? lerp(1, centerIntensity, centerAmount) : 0,
        expansionWeight: 1,
      };
    },
  };
}

/** Every vertex emits at full weight. */
export function createPassthroughEmissionProfile(): EmissionProfile {
  return {
    evaluate(): EmissionDecision {
      return { emits: true, intensityWeight: 1, expansionWeight: 1 };
    },
  };
}
