/**
 * River channel sizing from accumulated flow.
 *
 * Width grows sub-linearly with upstream catchment (≈ sqrt), so tributaries
 * widen smoothly as they merge downstream. Depth scales with width but is capped
 * to keep carved valleys believable.
 */
import type { GenParams } from "../../mapTypes.ts";

export function flowToWidth(flow: number, threshold: number, params: GenParams): number {
  const rel = Math.max(1, flow / threshold);
  const w = 1.2 * Math.sqrt(rel) * params.riverWidthMultiplier;
  return Math.min(14, Math.max(1.0, w));
}

export function flowToDepth(width: number, params: GenParams): number {
  // Wider rivers carve a bit deeper; carving strength scales the whole effect.
  return Math.min(0.06, 0.012 + width * 0.0035) * (0.4 + params.riverCarvingStrength);
}
