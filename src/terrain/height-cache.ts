// ── Becoming Many — Chunk Height Cache ─────────────────────────
//
// Chunk providers (e.g. worldgen) have no cheap pointwise height — their surface
// is baked per chunk in the worker. The flight floor + decoration placement still
// need a height(x,z), so we keep each loaded chunk's world-Y vertex grid and
// bilinear-sample the chunk that owns (x,z). This reads the SAME data the mesh was
// built from, so the floor matches the rendered surface exactly (no re-eval, no
// drift). Populated on chunk build, pruned on dispose (TerrainWorld wires both).

import { cellToWorldMin, chunkKey, worldToCell } from "./coords.ts";

export interface HeightEntry {
  /** (vpe)² world-Y grid, row-major, as the worker emits it. */
  heightGrid: Float32Array;
  /** World X/Z of vertex (0,0) — the chunk's min corner. */
  originX: number;
  originZ: number;
  /** World units between adjacent vertices. */
  step: number;
  /** Vertices per edge. */
  vpe: number;
}

/** Build a sampling entry from a chunk's local height grid. */
export function makeHeightEntry(
  gridX: number,
  gridZ: number,
  chunkSize: number,
  heightGrid: Float32Array,
): HeightEntry {
  const vpe = Math.round(Math.sqrt(heightGrid.length));
  return {
    heightGrid,
    originX: cellToWorldMin(gridX, chunkSize),
    originZ: cellToWorldMin(gridZ, chunkSize),
    step: chunkSize / Math.max(1, vpe - 1),
    vpe,
  };
}

/** Read a grid cell, defaulting out-of-range indices to 0 (edge clamp guarantees
 *  the callers stay in range; the default only satisfies noUncheckedIndexedAccess). */
function at(grid: Float32Array, i: number): number {
  return grid[i] ?? 0;
}

/** Bilinear world-Y from one chunk's height grid (clamped at the edges). */
export function sampleEntry(e: HeightEntry, x: number, z: number): number {
  const fx = (x - e.originX) / e.step;
  const fz = (z - e.originZ) / e.step;
  const max = e.vpe - 1;
  let x0 = Math.floor(fx);
  let z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  if (x0 < 0) x0 = 0;
  else if (x0 > max) x0 = max;
  if (z0 < 0) z0 = 0;
  else if (z0 > max) z0 = max;
  const x1 = x0 + 1 <= max ? x0 + 1 : max;
  const z1 = z0 + 1 <= max ? z0 + 1 : max;
  const g = e.heightGrid;
  const v00 = at(g, z0 * e.vpe + x0);
  const v10 = at(g, z0 * e.vpe + x1);
  const v01 = at(g, z1 * e.vpe + x0);
  const v11 = at(g, z1 * e.vpe + x1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * tz;
}

export class ChunkHeightCache {
  private readonly entries = new Map<string, HeightEntry>();

  constructor(private readonly chunkSize: number) {}

  add(gridX: number, gridZ: number, heightGrid: Float32Array): void {
    this.entries.set(
      chunkKey(gridX, gridZ),
      makeHeightEntry(gridX, gridZ, this.chunkSize, heightGrid),
    );
  }

  remove(gridX: number, gridZ: number): void {
    this.entries.delete(chunkKey(gridX, gridZ));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** World ground height at (x,z), or `fallback` if the owning chunk isn't loaded. */
  sample(x: number, z: number, fallback = 0): number {
    return this.sampleOrNull(x, z) ?? fallback;
  }

  /** World ground height at (x,z), or `null` if the owning chunk isn't loaded — so
   *  callers (e.g. the flight floor) can tell "no data" apart from "ground is 0". */
  sampleOrNull(x: number, z: number): number | null {
    const gx = worldToCell(x, this.chunkSize);
    const gz = worldToCell(z, this.chunkSize);
    const e = this.entries.get(chunkKey(gx, gz));
    return e ? sampleEntry(e, x, z) : null;
  }
}
