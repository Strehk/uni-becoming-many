// ── Becoming Many — World Map Generator (Phase 2 baseline) ──────
//
// Top-level generation orchestrator. Per chunk it runs the CPU field passes (fine
// height, temperature, base moisture), the slope pass, water-distance/shore, and
// per-pixel biome classification, then trims a real-neighbour apron so chunk
// borders stay seamless.
//
// Height comes straight from the continuous `fields.ts`; the mid-land biome is
// authored by the Pass A macro WFC plan (stamped per pixel), with water/peak edges
// refined from the fields. Hydrology (rivers/lakes) is still absent — those maps
// stay zero until Phase 5. Phase 4 adds the height WFC (Pass B). The class shape
// (constructor / clearCaches / generateChunk) is stable across phases.
//
// PURE CPU — no three, no DOM.

import { classifyChunk } from "../BiomeGenerator.ts";
import { baseMoisture01, fineHeight01, temperature01 } from "../fields.ts";
import { computeSlope } from "../hydrology/SlopeMapGenerator.ts";
import { computeWaterDistanceAndDerived } from "../hydrology/WaterDistanceMapGenerator.ts";
import { stampRivers } from "../hydrology/rivers/RiverCarving.ts";
import type { ChunkData, GenParams, RegionData, RiverNetwork, RiverPoint } from "../mapTypes.ts";
import { seedToOffset } from "../rng.ts";
import { MacroWorldGenerator } from "./MacroWorldGenerator.ts";
import { RegionManager } from "./RegionManager.ts";
import { chunkOrigin, regionKey } from "./WorldCoords.ts";

function emptyChunk(cx: number, cy: number, size: number): ChunkData {
  const n = size * size;
  return {
    cx,
    cy,
    size,
    heightMap: new Float32Array(n),
    moistureMap: new Float32Array(n),
    temperatureMap: new Float32Array(n),
    slopeMap: new Float32Array(n),
    biomeMap: new Uint8Array(n),
    riverMap: new Float32Array(n),
    flowAccumulationMap: new Float32Array(n),
    lakeMap: new Float32Array(n),
    waterDistanceMap: new Float32Array(n),
    shoreMap: new Float32Array(n),
    vegetationDensityMap: new Float32Array(n),
    macroMap: new Uint8Array(n),
    waterSurfaceMap: new Float32Array(n),
    waterMask: new Uint8Array(n),
    heightMapBordered: new Float32Array((size + 2) * (size + 2)),
    landformHeightBordered: new Float32Array((size + 2) * (size + 2)),
    slopeMapBordered: new Float32Array((size + 2) * (size + 2)),
    moistureMapBordered: new Float32Array((size + 2) * (size + 2)),
    temperatureMapBordered: new Float32Array((size + 2) * (size + 2)),
    waterDistanceMapBordered: new Float32Array((size + 2) * (size + 2)),
    riverMapBordered: new Float32Array((size + 2) * (size + 2)),
    lakeMapBordered: new Float32Array((size + 2) * (size + 2)),
    flowAccumulationMapBordered: new Float32Array((size + 2) * (size + 2)),
    waterSurfaceMapBordered: new Float32Array((size + 2) * (size + 2)),
    riverPaths: [],
  };
}

export class WorldMapGenerator {
  private readonly regions = new RegionManager(new MacroWorldGenerator());

  clearCaches(): void {
    this.regions.clear();
  }

  async generateChunk(cx: number, cy: number, params: GenParams): Promise<ChunkData> {
    const size = params.chunkSize;
    const origin = chunkOrigin(cx, cy, size);

    // Work on a padded buffer (apron of real neighbour data) so every CPU
    // neighbourhood op — slope, water distance, moisture boost, biome — is
    // computed against true neighbours at the chunk edges. The apron is trimmed
    // before returning, leaving seamless chunk borders.
    const A = WorldMapGenerator.APRON;
    const W = size + 2 * A;
    const pOx = origin.x - A;
    const pOy = origin.y - A;
    const pad = emptyChunk(cx, cy, W);

    // CPU field passes over the padded extent. Cell (lx,ly) samples world
    // (pOx+lx, pOy+ly) — one world px per cell at chunk resolution.
    const seedOffset = seedToOffset(params.seed);
    for (let ly = 0; ly < W; ly++) {
      for (let lx = 0; lx < W; lx++) {
        const wx = pOx + lx;
        const wy = pOy + ly;
        const i = ly * W + lx;
        pad.heightMap[i] = fineHeight01(wx, wy, seedOffset, params);
        pad.temperatureMap[i] = temperature01(wx, wy, seedOffset, params);
        pad.moistureMap[i] = baseMoisture01(wx, wy, seedOffset, params);
      }
    }

    // Pass A macro plan: fetch every region overlapping the padded rect (a chunk
    // can straddle up to 2×2 regions; gather one extra macro cell so a cross-region
    // stamp has all corners), build a local macro-tile grid, and stamp each pixel's
    // nearest macro tile into pad.macroMap. The biome classifier reads it.
    const cs = params.macroCellSize;
    const regions = await this.regions.regionsForRect(
      pOx - cs,
      pOy - cs,
      pOx + W + cs,
      pOy + W + cs,
      params,
    );
    const mmx0 = Math.floor(pOx / cs) - 1;
    const mmy0 = Math.floor(pOy / cs) - 1;
    const LW = Math.floor((pOx + W - 1) / cs) + 1 - mmx0 + 1;
    const LH = Math.floor((pOy + W - 1) / cs) + 1 - mmy0 + 1;
    const locTiles = new Uint8Array(LW * LH);
    for (let ly = 0; ly < LH; ly++) {
      for (let lx = 0; lx < LW; lx++) {
        locTiles[ly * LW + lx] = this.regions.tileAt(mmx0 + lx, mmy0 + ly, regions, params);
      }
    }
    for (let py = 0; py < W; py++) {
      const ny = Math.floor((pOy + py) / cs) - mmy0;
      for (let px = 0; px < W; px++) {
        const nx = Math.floor((pOx + px) / cs) - mmx0;
        pad.macroMap[py * W + px] = locTiles[ny * LW + nx] ?? 0;
      }
    }

    // Pass B landform elevation: sample each region's per-meso-cell target
    // elevation (cross-region, from the owning region) into a local grid, then
    // bilinear per pixel. Each global meso cell has ONE value (its owning region's),
    // so adjacent chunks read identical values at shared pixels → seamless relief.
    const m = Math.max(1, Math.round(params.mesoSubdiv));
    const mesoSize = cs / m;
    const em0x = Math.floor(pOx / mesoSize) - 1;
    const em0y = Math.floor(pOy / mesoSize) - 1;
    const EW = Math.floor((pOx + W - 1) / mesoSize) + 1 - em0x + 1;
    const EH = Math.floor((pOy + W - 1) / mesoSize) + 1 - em0y + 1;
    const locElev = new Float32Array(EW * EH);
    for (let ey = 0; ey < EH; ey++) {
      for (let ex = 0; ex < EW; ex++) {
        locElev[ey * EW + ex] = landformElevAt(em0x + ex, em0y + ey, regions, params);
      }
    }
    const padLandform = new Float32Array(W * W);
    for (let py = 0; py < W; py++) {
      const fmy = (pOy + py) / mesoSize - 0.5 - em0y;
      for (let px = 0; px < W; px++) {
        const fmx = (pOx + px) / mesoSize - 0.5 - em0x;
        padLandform[py * W + px] = bilinearLocal(locElev, EW, EH, fmx, fmy);
      }
    }

    // Drainage stamp: macro flow accumulation + lake depth/surface, resolved
    // across regions once into local grids, then bilinear per pixel.
    const locAccum = new Float32Array(LW * LH);
    const locLake = new Float32Array(LW * LH);
    const locLakeSurf = new Float32Array(LW * LH);
    for (let ly = 0; ly < LH; ly++) {
      for (let lx = 0; lx < LW; lx++) {
        const mx = mmx0 + lx;
        const my = mmy0 + ly;
        const li = ly * LW + lx;
        locAccum[li] = macroCellValue(regions, mx, my, params, (r) => r.macroAccum);
        locLake[li] = macroCellValue(regions, mx, my, params, (r) => r.lakeDepth);
        locLakeSurf[li] = macroCellValue(regions, mx, my, params, (r) => r.lakeSurface);
      }
    }
    for (let py = 0; py < W; py++) {
      const fmy = (pOy + py) / cs - 0.5 - mmy0;
      for (let px = 0; px < W; px++) {
        const fmx = (pOx + px) / cs - 0.5 - mmx0;
        const i = py * W + px;
        pad.flowAccumulationMap[i] = bilinearLocal(locAccum, LW, LH, fmx, fmy);
        pad.lakeMap[i] = Math.min(1, bilinearLocal(locLake, LW, LH, fmx, fmy) * 8);
      }
    }

    // Carve river polylines from every overlapping region into the pad.
    const networks: RiverNetwork[] = [];
    for (const region of regions.values()) if (region.rivers) networks.push(region.rivers);
    stampRivers(pad, pOx, pOy, networks, params);

    // Derived CPU passes on the padded buffer.
    pad.slopeMap = computeSlope(pad.heightMap, W);
    computeWaterDistanceAndDerived(pad, params);
    // Land biomes are classified per-pixel from the continuous fields (soft,
    // terrain-following boundaries) rather than stamped from the coarse macro WFC
    // cells (which read as 32 m squares). The macro plan still drives landform
    // (Pass B) + hydrology; `classifyChunkFromMacro` remains for the block-style
    // variant. The stamped `pad.macroMap` is retained for debug/overlays.
    classifyChunk(pad, params, pOx, pOy);

    // Water surface + mask (after carving so rivers are present): ocean at sea
    // level, lakes flat at their surface, rivers following the carved channel.
    const wl = params.waterLevel;
    for (let py = 0; py < W; py++) {
      const fmy = (pOy + py) / cs - 0.5 - mmy0;
      for (let px = 0; px < W; px++) {
        const fmx = (pOx + px) / cs - 0.5 - mmx0;
        const i = py * W + px;
        const h = pad.heightMap[i] ?? 0;
        const lake = bilinearLocal(locLake, LW, LH, fmx, fmy);
        if (lake > 0.02) {
          // Lake takes priority over ocean; the surface must be perfectly FLAT at
          // the basin's spill level — take the max of the surrounding macro
          // lake-surface cells (constant across a basin) instead of following bed.
          const surf = maxLocal2x2(locLakeSurf, LW, LH, fmx, fmy);
          pad.waterSurfaceMap[i] = surf > 0 ? surf : Math.max(h, wl);
          pad.waterMask[i] = 1;
        } else if (h < wl) {
          pad.waterSurfaceMap[i] = wl;
          pad.waterMask[i] = 1;
        } else if ((pad.riverMap[i] ?? 0) > 0.12) {
          pad.waterSurfaceMap[i] = h + 0.004;
          pad.waterMask[i] = 1;
        }
      }
    }

    // Trim the apron into the final chunk.
    const chunk = emptyChunk(cx, cy, size);
    trim(pad.heightMap, chunk.heightMap, W, A, size);
    trim(pad.waterSurfaceMap, chunk.waterSurfaceMap, W, A, size);
    trim(pad.waterMask, chunk.waterMask, W, A, size);
    // 1px-bordered height for crack-free 3D terrain meshes.
    {
      const BS = size + 2;
      for (let py = 0; py < BS; py++) {
        const srcStart = (A - 1 + py) * W + (A - 1);
        chunk.heightMapBordered.set(pad.heightMap.subarray(srcStart, srcStart + BS), py * BS);
        chunk.landformHeightBordered.set(padLandform.subarray(srcStart, srcStart + BS), py * BS);
        chunk.slopeMapBordered.set(pad.slopeMap.subarray(srcStart, srcStart + BS), py * BS);
        chunk.moistureMapBordered.set(pad.moistureMap.subarray(srcStart, srcStart + BS), py * BS);
        chunk.temperatureMapBordered.set(
          pad.temperatureMap.subarray(srcStart, srcStart + BS),
          py * BS,
        );
        chunk.waterDistanceMapBordered.set(
          pad.waterDistanceMap.subarray(srcStart, srcStart + BS),
          py * BS,
        );
        chunk.riverMapBordered.set(pad.riverMap.subarray(srcStart, srcStart + BS), py * BS);
        chunk.lakeMapBordered.set(pad.lakeMap.subarray(srcStart, srcStart + BS), py * BS);
        chunk.flowAccumulationMapBordered.set(
          pad.flowAccumulationMap.subarray(srcStart, srcStart + BS),
          py * BS,
        );
        chunk.waterSurfaceMapBordered.set(
          pad.waterSurfaceMap.subarray(srcStart, srcStart + BS),
          py * BS,
        );
      }
    }
    trim(pad.moistureMap, chunk.moistureMap, W, A, size);
    trim(pad.temperatureMap, chunk.temperatureMap, W, A, size);
    trim(pad.slopeMap, chunk.slopeMap, W, A, size);
    trim(pad.riverMap, chunk.riverMap, W, A, size);
    trim(pad.flowAccumulationMap, chunk.flowAccumulationMap, W, A, size);
    trim(pad.lakeMap, chunk.lakeMap, W, A, size);
    trim(pad.waterDistanceMap, chunk.waterDistanceMap, W, A, size);
    trim(pad.shoreMap, chunk.shoreMap, W, A, size);
    trim(pad.vegetationDensityMap, chunk.vegetationDensityMap, W, A, size);
    trim(pad.biomeMap, chunk.biomeMap, W, A, size);
    trim(pad.macroMap, chunk.macroMap, W, A, size);
    chunk.riverPaths = clipRiverPaths(networks, origin.x, origin.y, size);
    return chunk;
  }

  private static readonly APRON = 24;
}

/** Value of a per-region macro field at a global macro cell, across regions. */
function macroCellValue(
  regions: Map<string, RegionData>,
  mx: number,
  my: number,
  params: GenParams,
  sel: (r: RegionData) => Float32Array | undefined,
): number {
  const RM = params.macroResolution;
  const rx = Math.floor(mx / RM);
  const ry = Math.floor(my / RM);
  const region = regions.get(regionKey(rx, ry));
  if (!region) return 0;
  const arr = sel(region);
  if (!arr) return 0;
  return arr[(my - ry * RM) * RM + (mx - rx * RM)] ?? 0;
}

/** Max of the 2×2 macro cells around (fx,fy) — the flat lake spill level. */
function maxLocal2x2(arr: Float32Array, LW: number, LH: number, fx: number, fy: number): number {
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  if (x0 < 0) x0 = 0;
  else if (x0 > LW - 1) x0 = LW - 1;
  if (y0 < 0) y0 = 0;
  else if (y0 > LH - 1) y0 = LH - 1;
  const x1 = x0 + 1 < LW ? x0 + 1 : LW - 1;
  const y1 = y0 + 1 < LH ? y0 + 1 : LH - 1;
  return Math.max(
    arr[y0 * LW + x0] ?? 0,
    arr[y0 * LW + x1] ?? 0,
    arr[y1 * LW + x0] ?? 0,
    arr[y1 * LW + x1] ?? 0,
  );
}

/** River point runs touching a chunk's footprint (+margin), deduped by first
 *  segment key so overlapping regions don't emit a ribbon twice. World coords. */
function clipRiverPaths(
  networks: RiverNetwork[],
  ox: number,
  oy: number,
  size: number,
): RiverPoint[][] {
  const M = 6; // world px margin so ribbons meet across chunk borders
  const minX = ox - M;
  const maxX = ox + size + M;
  const minY = oy - M;
  const maxY = oy + size + M;
  const out: RiverPoint[][] = [];
  const seen = new Set<number>();
  const inside = (x: number, y: number): boolean =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;
  for (const net of networks) {
    for (const path of net.paths) {
      const pts = path.points;
      let run: RiverPoint[] = [];
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        if (!cur) continue;
        const prevP = i > 0 ? pts[i - 1] : undefined;
        const nextP = i < pts.length - 1 ? pts[i + 1] : undefined;
        const here = inside(cur.x, cur.y);
        const prev = prevP ? inside(prevP.x, prevP.y) : false;
        const next = nextP ? inside(nextP.x, nextP.y) : false;
        if (here || prev || next) {
          run.push(cur);
        } else if (run.length >= 2) {
          pushRun(run, out, seen);
          run = [];
        } else {
          run = [];
        }
      }
      if (run.length >= 2) pushRun(run, out, seen);
    }
  }
  return out;
}

function pushRun(run: RiverPoint[], out: RiverPoint[][], seen: Set<number>): void {
  const a = run[0];
  const b = run[1];
  if (!a || !b) return;
  const key =
    ((Math.round(a.x) & 0xffff) << 16) ^
    (Math.round(a.y) & 0xffff) ^
    (Math.round(b.x) * 131 + Math.round(b.y) * 977);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(run);
}

/** Pass B target elevation at a global meso cell, from its owning region. */
function landformElevAt(
  gmx: number,
  gmy: number,
  regions: Map<string, RegionData>,
  params: GenParams,
): number {
  const RMm = params.macroResolution * Math.max(1, Math.round(params.mesoSubdiv));
  const rx = Math.floor(gmx / RMm);
  const ry = Math.floor(gmy / RMm);
  const elev = regions.get(regionKey(rx, ry))?.landformElevation;
  if (!elev) return 0.5;
  const lx = gmx - rx * RMm;
  const ly = gmy - ry * RMm;
  return elev[ly * RMm + lx] ?? 0.5;
}

/** Bilinear sample of a local grid (continuous, already cross-region resolved). */
function bilinearLocal(arr: Float32Array, LW: number, LH: number, fx: number, fy: number): number {
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  if (x0 < 0) x0 = 0;
  else if (x0 > LW - 1) x0 = LW - 1;
  if (y0 < 0) y0 = 0;
  else if (y0 > LH - 1) y0 = LH - 1;
  const x1 = x0 + 1 < LW ? x0 + 1 : LW - 1;
  const y1 = y0 + 1 < LH ? y0 + 1 : LH - 1;
  const v00 = arr[y0 * LW + x0] ?? 0;
  const v10 = arr[y0 * LW + x1] ?? 0;
  const v01 = arr[y1 * LW + x0] ?? 0;
  const v11 = arr[y1 * LW + x1] ?? 0;
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** Copy the interior (apron removed) of a W×W padded array into a size×size array. */
function trim(
  src: Float32Array | Uint8Array,
  dst: Float32Array | Uint8Array,
  W: number,
  A: number,
  size: number,
): void {
  for (let py = 0; py < size; py++) {
    const srcStart = (py + A) * W + A;
    const dstStart = py * size;
    for (let px = 0; px < size; px++) {
      dst[dstStart + px] = src[srcStart + px] ?? 0;
    }
  }
}
