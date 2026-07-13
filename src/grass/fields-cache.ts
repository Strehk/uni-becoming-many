// ── Becoming Many — Grass Fields Cache ─────────────────────────
//
// A CPU cache of each live chunk's placement `fields`, mirroring `ChunkHeightCache`
// (`src/terrain/height-cache.ts`). Fed by the SAME `onChunkBuilt`/`onChunkDisposed`
// hooks `src/life/` consumes, it answers `grassMaskAt(x,z)` — the biome/vegetation/
// slope/water suitability the field texture painter bakes into the grass mask.
//
// Fields are downsampled per chunk (res ~64 over 256 m ≈ 4 m/cell); a NEAREST read is
// right here (biome is a discrete id and the mask is coarse by nature).

import { cellToWorldMin, chunkKey, worldToCell } from "../terrain/coords.ts";
import type { ChunkFields } from "../terrain/index.ts";
import { grassMask } from "./biomes.ts";

export class FieldsCache {
  private readonly entries = new Map<string, ChunkFields>();

  constructor(private readonly chunkSize: number) {}

  add(gridX: number, gridZ: number, fields: ChunkFields): void {
    this.entries.set(chunkKey(gridX, gridZ), fields);
  }

  remove(gridX: number, gridZ: number): void {
    this.entries.delete(chunkKey(gridX, gridZ));
  }

  clear(): void {
    this.entries.clear();
  }

  /** Grass suitability 0..1 at world (x,z), or 0 when the owning chunk isn't loaded. */
  grassMaskAt(x: number, z: number): number {
    const gx = worldToCell(x, this.chunkSize);
    const gz = worldToCell(z, this.chunkSize);
    const f = this.entries.get(chunkKey(gx, gz));
    if (!f) return 0;

    const originX = cellToWorldMin(gx, this.chunkSize);
    const originZ = cellToWorldMin(gz, this.chunkSize);
    const u = (x - originX) / this.chunkSize; // 0..1 across the chunk
    const v = (z - originZ) / this.chunkSize;
    const cx = Math.min(f.res - 1, Math.max(0, Math.floor(u * f.res)));
    const cz = Math.min(f.res - 1, Math.max(0, Math.floor(v * f.res)));
    const cell = cz * f.res + cx;

    return grassMask(
      f.biome[cell] ?? 0,
      f.vegetation[cell] ?? 0,
      f.slope[cell] ?? 1,
      f.water[cell] ?? 1,
    );
  }
}
