import { type TerrainDetailGenerator, heightToWorldY } from "../height/TerrainDetailGenerator.ts";
import type { TerrainSampler } from "../height/TerrainSampler.ts";
/**
 * Builds a chunk's water as plain vertex arrays (was WolrdGen3's LakeMeshBuilder
 * + RiverMeshBuilder, which produced three BufferGeometries). Emits NO three —
 * the worker transfers `positions` + `colors`; the main thread wraps them with
 * the shared water material.
 *
 * Two sources, merged into one non-indexed mesh (they share the water material):
 *   - Still water (ocean + lakes): a coarse grid emits a flat quad per cell whose
 *     four corners are submerged, at that cell's baked water level.
 *   - Rivers: ribbon strips extruded along the Stage-1 river polylines, anchored
 *     to the rendered bed + a thin film so they hug the channel.
 *
 * Coordinates are chunk-LOCAL, centred on the chunk (matching the terrain mesh),
 * so the water mesh parents under the terrain mesh exactly like decorations.
 */
import type { GenParams } from "../mapTypes.ts";
import { waterVertexColor } from "./shoreline.ts";

export interface WaterArrays {
  positions: Float32Array;
  colors: Float32Array;
}

export function buildWaterArrays(
  sampler: TerrainSampler,
  detail: TerrainDetailGenerator,
  params: GenParams,
  segments: number,
): WaterArrays | null {
  const positions: number[] = [];
  const colors: number[] = [];

  buildStillWater(sampler, params, segments, positions, colors);
  buildRivers(sampler, detail, params, segments, positions, colors);

  if (positions.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}

/** Bilinear sample of a row-major size×size array at fractional pixel (fx,fy). */
function bilinearClamped(arr: Float32Array, size: number, fx: number, fy: number): number {
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  if (x0 < 0) x0 = 0;
  else if (x0 > size - 1) x0 = size - 1;
  if (y0 < 0) y0 = 0;
  else if (y0 > size - 1) y0 = size - 1;
  const x1 = x0 + 1 < size ? x0 + 1 : size - 1;
  const y1 = y0 + 1 < size ? y0 + 1 : size - 1;
  const v00 = arr[y0 * size + x0] ?? 0;
  const v10 = arr[y0 * size + x1] ?? 0;
  const v01 = arr[y1 * size + x0] ?? 0;
  const v11 = arr[y1 * size + x1] ?? 0;
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** One vertex of the per-cell water polygon: grid coords + world-space depth. */
interface WaterVert {
  gx: number;
  gy: number;
  depth: number;
}

/**
 * Ocean + lakes: a flat sheet at the baked water level, but with the shoreline
 * fit to the real waterline via marching squares instead of snapping to the
 * cell grid. Each cell classifies its four corners as wet (terrain below the
 * water surface) or dry, then triangulates the wet sub-region — edge crossings
 * are interpolated to the exact land/water boundary, so the silhouette is smooth
 * rather than stair-stepped, and the foam tint (depth → 0 at the crossing) fades
 * as a thin shore band instead of blocky white patches.
 */
function buildStillWater(
  sampler: TerrainSampler,
  params: GenParams,
  segments: number,
  positions: number[],
  colors: number[],
): void {
  const chunk = sampler.data;
  const size = sampler.size;
  const res = Math.min(96, Math.max(24, segments));
  const step = size / res;
  const half = size / 2;
  const sea = params.waterLevel;
  const { waterSurfaceMap, heightMap, lakeMap } = chunk;

  const px = (t: number): number => Math.min(size - 1, Math.max(0, Math.round(t - 0.5)));

  // Per grid-vertex caches over the (res+1)² lattice. `bed` is the bilinear
  // terrain height (smooth, sub-cell waterline crossings); `surf0` is the flat
  // STILL-water surface level (ocean = sea, lakes = spill) and 0 on land or on
  // river-film cells — rivers are drawn as ribbons below, so including them here
  // rendered broken terraced fragments.
  const n = res + 1;
  const bed = new Float32Array(n * n);
  const surf0 = new Float32Array(n * n);
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const k = j * n + i;
      const idx = px(j * step) * size + px(i * step);
      bed[k] = bilinearClamped(heightMap, size, i * step - 0.5, j * step - 0.5);
      surf0[k] =
        (heightMap[idx] ?? 0) < sea || (lakeMap[idx] ?? 0) > 0.08 ? (waterSurfaceMap[idx] ?? 0) : 0;
    }
  }

  // Dilate the flat surface outward by one grid cell so a boundary cell just
  // past the rasterised water mask still carries the water level; the
  // f = level − bed test below then clips it to the true sub-cell waterline.
  // Without this the silhouette snapped to the mask raster (square lake edges):
  // nearest-neighbour gating left edge cells with no wet corner, so marching
  // squares never fired there.
  const surf = new Float32Array(n * n);
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj > res) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii > res) continue;
          const v = surf0[jj * n + ii] ?? 0;
          if (v > m) m = v;
        }
      }
      surf[j * n + i] = m;
    }
  }

  const pushVert = (v: WaterVert, levelY: number): void => {
    positions.push(-half + v.gx * step, levelY, -half + v.gy * step);
    const c = waterVertexColor(v.depth, false);
    colors.push(c[0], c[1], c[2]);
  };

  // Corner walk order (CCW): the cell's four corners interleaved with its four
  // edges. `cgx/cgy` give each corner's grid position.
  const cgx = [0, 1, 1, 0];
  const cgy = [0, 0, 1, 1];

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const ks = [j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i];
      // The cell's flat water surface = highest (dilated) still-water level at
      // its corners; 0 means no water nearby, so skip.
      let level = 0;
      for (let c = 0; c < 4; c++) {
        const sv = surf[ks[c] ?? 0] ?? 0;
        if (sv > level) level = sv;
      }
      if (level <= 0) continue;

      // Signed depth field per corner (water surface − terrain bed); >0 is
      // submerged. The waterline is the 0-isoline we fit to.
      const f = [
        level - (bed[ks[0] ?? 0] ?? 0),
        level - (bed[ks[1] ?? 0] ?? 0),
        level - (bed[ks[2] ?? 0] ?? 0),
        level - (bed[ks[3] ?? 0] ?? 0),
      ];

      // Build the submerged sub-polygon by walking corners + edges.
      const poly: WaterVert[] = [];
      for (let c = 0; c < 4; c++) {
        const fc = f[c] ?? 0;
        if (fc > 0) poly.push({ gx: i + (cgx[c] ?? 0), gy: j + (cgy[c] ?? 0), depth: fc });
        const d = (c + 1) % 4;
        const fa = f[c] ?? 0;
        const fb = f[d] ?? 0;
        if (fa > 0 !== fb > 0) {
          const t = fa / (fa - fb);
          poly.push({
            gx: i + (cgx[c] ?? 0) + ((cgx[d] ?? 0) - (cgx[c] ?? 0)) * t,
            gy: j + (cgy[c] ?? 0) + ((cgy[d] ?? 0) - (cgy[c] ?? 0)) * t,
            depth: 0,
          });
        }
      }
      if (poly.length < 3) continue;

      // Convert the normalised depth field to a true world-space water column
      // so the deep/shallow/foam tint reads correctly.
      const levelY = heightToWorldY(level, params);
      for (const v of poly) v.depth = levelY - heightToWorldY(level - v.depth, params);

      // Fan-triangulate the (convex within a cell) polygon.
      for (let t = 1; t < poly.length - 1; t++) {
        const p0 = poly[0];
        const pa = poly[t];
        const pb = poly[t + 1];
        if (!p0 || !pa || !pb) continue;
        pushVert(p0, levelY);
        pushVert(pa, levelY);
        pushVert(pb, levelY);
      }
    }
  }
}

/** Rivers: ribbon strips along the Stage-1 polylines, anchored to the bed + film. */
function buildRivers(
  sampler: TerrainSampler,
  detail: TerrainDetailGenerator,
  params: GenParams,
  segments: number,
  positions: number[],
  colors: number[],
): void {
  const runs = sampler.data.riverPaths;
  if (!runs || runs.length === 0) return;

  const size = sampler.size;
  const cx = sampler.originX + size / 2;
  const cy = sampler.originY + size / 2;
  const ox = sampler.originX;
  const oy = sampler.originY;
  const res = Math.max(8, segments | 0);
  const step = size / res;
  const sea = params.waterLevel;
  const { waterMask, heightMap, lakeMap } = sampler.data;

  // True where a world point falls inside still water (ocean/lake), which is
  // already drawn by the slab above. Rivers stop here so the two translucent
  // surfaces never stack into hard-edged over-bright bands at the river mouth.
  const inStillWater = (wx: number, wy: number): boolean => {
    const pi = Math.floor(wx - ox);
    const pj = Math.floor(wy - oy);
    if (pi < 0 || pj < 0 || pi >= size || pj >= size) return false;
    const idx = pj * size + pi;
    return (
      (waterMask[idx] ?? 0) === 1 && ((heightMap[idx] ?? 0) < sea || (lakeMap[idx] ?? 0) > 0.08)
    );
  };

  // Rendered terrain height (bilinear over the mesh grid) at a world point, so
  // the river film sits just above the visible surface — never floats or is
  // swallowed by a coarse-meshed channel.
  const meshedGroundY = (wx: number, wy: number): number => {
    const gx = (wx - ox) / step;
    const gy = (wy - oy) / step;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const tx = gx - i0;
    const ty = gy - j0;
    const x0 = ox + i0 * step;
    const y0 = oy + j0 * step;
    const h00 = detail.worldY(x0, y0, sampler);
    const h10 = detail.worldY(x0 + step, y0, sampler);
    const h01 = detail.worldY(x0, y0 + step, sampler);
    const h11 = detail.worldY(x0 + step, y0 + step, sampler);
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  };

  for (const pts of runs) {
    if (pts.length < 2) continue;
    const L: [number, number, number][] = [];
    const R: [number, number, number][] = [];
    const col: [number, number, number][] = [];
    const still: boolean[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      still.push(inStillWater(p.x, p.y));
      const a = pts[Math.max(0, i - 1)] ?? p;
      const b = pts[Math.min(pts.length - 1, i + 1)] ?? p;
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty;
      const ny = tx;
      const halfW = Math.max(2.5, p.width * 0.95) * params.riverWidthMultiplier;
      const lx = p.x + nx * halfW;
      const lz = p.y + ny * halfW;
      const rx = p.x - nx * halfW;
      const rz = p.y - ny * halfW;
      const fill = params.riverWaterOffset + Math.min(1.5, p.width * 0.15);
      // Drape each bank onto the terrain it actually sits over (not the
      // centreline) so the ribbon hugs the channel cross-section instead of
      // floating off the low bank / cutting through the high one.
      L.push([lx - cx, meshedGroundY(lx, lz) + fill, lz - cy]);
      R.push([rx - cx, meshedGroundY(rx, rz) + fill, rz - cy]);
      // Tint by a width-scaled channel depth — driving colour off `fill`
      // (sub-foam) made every river read as blown-out white foam.
      const tintDepth = Math.min(10, 2.5 + p.width * 0.4);
      col.push(waterVertexColor(tintDepth, true));
    }
    for (let i = 0; i < pts.length - 1; i++) {
      // Drop segments that touch still water — the ocean/lake slab covers
      // that span, so emitting the ribbon there would double-blend.
      if ((still[i] ?? false) || (still[i + 1] ?? false)) continue;
      const l0 = L[i];
      const r0 = R[i];
      const l1 = L[i + 1];
      const r1 = R[i + 1];
      const c0 = col[i];
      const c1 = col[i + 1];
      if (!l0 || !r0 || !l1 || !r1 || !c0 || !c1) continue;
      positions.push(l0[0], l0[1], l0[2], l1[0], l1[1], l1[2], r0[0], r0[1], r0[2]);
      colors.push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c0[0], c0[1], c0[2]);
      positions.push(r0[0], r0[1], r0[2], l1[0], l1[1], l1[2], r1[0], r1[1], r1[2]);
      colors.push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c1[0], c1[1], c1[2]);
    }
  }
}
