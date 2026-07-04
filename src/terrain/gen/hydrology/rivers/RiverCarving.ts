/**
 * Rasterises river polylines into a chunk: stamps the river mask and carves the
 * height bed with a smooth banked falloff. Width/depth come from the per-point
 * flow, so stronger (more accumulated) rivers are wider and deeper.
 */
import type { ChunkData, GenParams, RiverNetwork } from "../../mapTypes.ts";

function smoothFalloff(dist: number, radius: number): number {
  const t = Math.max(0, Math.min(1, 1 - dist / radius));
  return t * t * (3 - 2 * t);
}

export function stampRivers(
  chunk: ChunkData,
  originX: number,
  originY: number,
  networks: RiverNetwork[],
  _params: GenParams,
): void {
  const size = chunk.size;
  const { heightMap, riverMap } = chunk;

  const stamp = (cx: number, cy: number, width: number, depth: number): void => {
    const r = width * 0.5 + 0.75;
    const lx = cx - originX;
    const ly = cy - originY;
    const px0 = Math.max(0, Math.floor(lx - r));
    const px1 = Math.min(size - 1, Math.ceil(lx + r));
    const py0 = Math.max(0, Math.floor(ly - r));
    const py1 = Math.min(size - 1, Math.ceil(ly + r));
    const strength = Math.max(0.3, Math.min(1, width / 6));
    for (let py = py0; py <= py1; py++) {
      const dy = py + 0.5 - ly;
      for (let px = px0; px <= px1; px++) {
        const dx = px + 0.5 - lx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        const fall = smoothFalloff(dist, r);
        const idx = py * size + px;
        const rv = strength * fall;
        if (rv > (riverMap[idx] ?? 0)) riverMap[idx] = rv;
        const h = (heightMap[idx] ?? 0) - depth * fall;
        heightMap[idx] = h < 0 ? 0 : h;
      }
    }
  };

  for (const net of networks) {
    for (const path of net.paths) {
      const pts = path.points;
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(len));
        for (let t = 0; t <= steps; t++) {
          const f = t / steps;
          stamp(
            a.x + dx * f,
            a.y + dy * f,
            a.width + (b.width - a.width) * f,
            a.depth + (b.depth - a.depth) * f,
          );
        }
      }
    }
  }
}
