// ── SENSE MODULE: Motion — target adapters ─────────────────────
//
// Ported from vogel_motion_sinn `module/targetAdapters.js`. Normalizes loose
// actor/group shapes into flat targets and produces the source-visibility
// RECOMMENDATIONS (the module never mutates host visibility itself — the host
// decides, per the prototype's confirmed design answers).

import type * as THREE from "three/webgpu";
import type { EmissionProfile } from "./emission-profiles.ts";

export interface MotionTarget {
  object: THREE.Object3D;
  className?: string;
  emissionProfile?: EmissionProfile;
}

export interface MotionTargetGroup {
  className?: string;
  name?: string;
  emissionProfile?: EmissionProfile;
  objects: readonly { object: THREE.Object3D; emissionProfile?: EmissionProfile }[];
}

export interface VisibilityRecommendation {
  className: string;
  object: THREE.Object3D;
  visible: boolean;
}

export function normalizeTargets(targetGroups: readonly MotionTargetGroup[]): MotionTarget[] {
  const targets: MotionTarget[] = [];
  for (const group of targetGroups) {
    for (const item of group.objects) {
      const className = group.className ?? group.name;
      const emissionProfile = item.emissionProfile ?? group.emissionProfile;
      targets.push({
        object: item.object,
        ...(className === undefined ? {} : { className }),
        ...(emissionProfile === undefined ? {} : { emissionProfile }),
      });
    }
  }
  return targets;
}

export function collectVisibilityRecommendations(
  targets: readonly MotionTarget[],
  visible: boolean,
): VisibilityRecommendation[] {
  return targets.map((target) => ({
    className: target.className ?? "default",
    object: target.object,
    visible,
  }));
}
