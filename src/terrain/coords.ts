// ── Becoming Many — Terrain Coordinate Helpers ─────────────────
//
// The world is tiled into square chunks of `chunkSize` world-metres. A chunk is
// addressed by an integer grid cell `(gridX, gridZ)`; world position `(x,z)` maps
// to `floor(x / chunkSize)`. These helpers centralise that math so the scheduler,
// height cache, and world orchestrator all agree on tiling + string keys.

/** Grid cell owning world X (or Z). */
export function worldToCell(coord: number, chunkSize: number): number {
  return Math.floor(coord / chunkSize);
}

/** World coordinate of a cell's minimum corner. */
export function cellToWorldMin(cell: number, chunkSize: number): number {
  return cell * chunkSize;
}

/** World coordinate of a cell's centre. */
export function cellToWorldCenter(cell: number, chunkSize: number): number {
  return cell * chunkSize + chunkSize / 2;
}

/** Stable map key for a chunk cell. */
export function chunkKey(gridX: number, gridZ: number): string {
  return `${gridX},${gridZ}`;
}
