// ── Becoming Many — Region Manager (LRU) ───────────────────────
//
// Caches per-region macro plans (+ drainage substrate, added in Phase 5).
// Regions are generated lazily and cached (bounded LRU). A chunk can straddle up
// to 2×2 regions, so callers fetch all overlapping regions via `regionsForRect`,
// then look up macro tiles per pixel with `tileAt`. PURE CPU — no three, no DOM.

import type { GenParams, RegionData } from "../mapTypes.ts";
import type { MacroWorldGenerator } from "./MacroWorldGenerator.ts";
import { regionKey } from "./WorldCoords.ts";

export class RegionManager {
  private macroGen: MacroWorldGenerator;
  private cache = new Map<string, RegionData>();
  private inflight = new Map<string, Promise<RegionData>>();
  private order: string[] = [];
  private maxCached = 64;

  constructor(macroGen: MacroWorldGenerator) {
    this.macroGen = macroGen;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.order = [];
  }

  /** All currently-cached regions (for overlays). */
  cachedRegions(): RegionData[] {
    return [...this.cache.values()];
  }

  /** Region index that contains global macro cell (mx,my). */
  regionOfMacro(mx: number, my: number, params: GenParams): { rx: number; ry: number } {
    const RM = params.macroResolution;
    return { rx: Math.floor(mx / RM), ry: Math.floor(my / RM) };
  }

  async getRegion(rx: number, ry: number, params: GenParams): Promise<RegionData> {
    const key = regionKey(rx, ry);
    const cached = this.cache.get(key);
    if (cached) {
      this.touch(key);
      return cached;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.macroGen.generate(rx, ry, params).then((data) => {
      this.cache.set(key, data);
      this.inflight.delete(key);
      this.touch(key);
      this.evict();
      return data;
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Fetch every region overlapping a world-space rectangle. */
  async regionsForRect(
    minWX: number,
    minWY: number,
    maxWX: number,
    maxWY: number,
    params: GenParams,
  ): Promise<Map<string, RegionData>> {
    const RM = params.macroResolution;
    const cs = params.macroCellSize;
    const regionWorld = RM * cs;
    const rx0 = Math.floor(minWX / regionWorld);
    const rx1 = Math.floor((maxWX - 1) / regionWorld);
    const ry0 = Math.floor(minWY / regionWorld);
    const ry1 = Math.floor((maxWY - 1) / regionWorld);
    const out = new Map<string, RegionData>();
    const jobs: Promise<void>[] = [];
    for (let ry = ry0; ry <= ry1; ry++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        jobs.push(
          this.getRegion(rx, ry, params).then((data) => {
            out.set(regionKey(rx, ry), data);
          }),
        );
      }
    }
    await Promise.all(jobs);
    return out;
  }

  /** Macro tile id at global macro cell (mx,my), using already-fetched regions. */
  tileAt(mx: number, my: number, regions: Map<string, RegionData>, params: GenParams): number {
    const RM = params.macroResolution;
    const rx = Math.floor(mx / RM);
    const ry = Math.floor(my / RM);
    const region = regions.get(regionKey(rx, ry));
    if (!region) return 0;
    const lx = mx - rx * RM;
    const ly = my - ry * RM;
    return region.macroTiles[ly * RM + lx] ?? 0;
  }

  private touch(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(key);
  }

  private evict(): void {
    while (this.order.length > this.maxCached) {
      const key = this.order.shift();
      if (key === undefined) break;
      this.cache.delete(key);
    }
  }
}
