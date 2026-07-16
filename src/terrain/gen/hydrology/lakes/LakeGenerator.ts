/**
 * Lakes from filled depressions.
 *
 * A cell is a lake where the priority-flood raised the surface above the terrain
 * (filled > height) and it sits above sea level. Lake depth = filled − height,
 * and the lake surface is flat at `filled`. Because the macro height is smooth,
 * genuine endorheic basins are rare → lakes are rare, matching the requirement
 * that rivers usually continue to the sea rather than ending in lakes.
 */
import { findSpillPoints } from "./SpillPointDetection.ts";

export interface LakeResult {
  lakeDepth: Float32Array; // 0 = none
  lakeSurface: Float32Array; // flat water level where lakeDepth>0
  spillIdx: number[]; // cell indices of basin outlets
}

export function detectLakes(
  height: Float32Array,
  filled: Float32Array,
  receiver: Int32Array,
  N: number,
  seaLevel: number,
  spillTolerance: number,
  lakeFrequency: number,
  maxHeight: number,
  lakeSize = 1,
): LakeResult {
  const eps = Math.max(0.0015, spillTolerance * (1.4 - lakeFrequency));
  // Filled basins are deepest in their centre. Requiring more depth trims only
  // their outer shoreline and therefore changes lake footprint without moving
  // or randomly cutting up a basin. Size 1 preserves the authored result.
  const sizeAdjustedEps = eps / Math.max(0.1, lakeSize);
  const lakeDepth = new Float32Array(N);
  const lakeSurface = new Float32Array(N);
  const lakeMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const fi = filled[i] ?? 0;
    const d = fi - (height[i] ?? 0);
    // No perched mountain lakes: a basin whose flat surface sits above maxHeight
    // is left as dry terrain (its detail noise read as broken slabs up there).
    if (d > sizeAdjustedEps && fi >= seaLevel && fi <= maxHeight) {
      lakeMask[i] = 1;
      lakeDepth[i] = d;
      lakeSurface[i] = fi;
    }
  }
  const spillIdx = findSpillPoints(lakeMask, receiver, N);
  return { lakeDepth, lakeSurface, spillIdx };
}
