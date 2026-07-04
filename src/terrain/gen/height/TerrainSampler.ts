// ── Becoming Many — Terrain Sampler ────────────────────────────
//
// Reads the Stage 1 maps of a single chunk in normalised chunk-local UV space
// (u,v ∈ [0,1]) or in world coordinates. The bridge between the macro 2D maps
// (source of truth) and the 3D detail layer.
//
// Seamlessness rule:
//   - sampleHeight() reads the 1px-bordered height, so adjacent chunks return the
//     SAME value at a shared edge → crack-free geometry.
//   - slopeAt() is derived from that bordered height → seam-free.
//   - The remaining per-pixel maps have no border; they feed only gentle shaping
//     and the material, where a sub-pixel edge mismatch is invisible.
//
// PURE CPU — no three, no DOM.

import type { ChunkData } from "../mapTypes.ts";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Bilinear sample of a row-major size×size array at fractional pixel (fx,fy). */
function bilinear(arr: Float32Array, size: number, fx: number, fy: number): number {
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

export class TerrainSampler {
  readonly data: ChunkData;
  readonly size: number;
  /** World coordinate of the chunk's min (top-left) cell origin. */
  readonly originX: number;
  readonly originY: number;
  private bs: number; // bordered side length

  constructor(data: ChunkData) {
    this.data = data;
    this.size = data.size;
    this.originX = data.cx * data.size;
    this.originY = data.cy * data.size;
    this.bs = data.size + 2;
  }

  private uvToPixel(u: number, v: number): { fx: number; fy: number } {
    // Pixel centres sit at +0.5; u=0 → first cell centre, u=1 → last cell centre.
    return { fx: u * this.size - 0.5, fy: v * this.size - 0.5 };
  }

  /** Seamless height (0..1) from the bordered map. u,v over the chunk footprint. */
  sampleHeight(u: number, v: number): number {
    const fx = u * this.size + 0.5; // border offset (1px) minus half-pixel centre
    const fy = v * this.size + 0.5;
    return bilinear(this.data.heightMapBordered, this.bs, fx, fy);
  }

  /** Seamless Pass B landform target elevation (0..1) from the bordered map. */
  sampleLandformHeight(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.landformHeightBordered, this.bs, fx, fy);
  }

  /**
   * Seamless slope (0..1) from the bordered slope map (computed in the worker off
   * the real-neighbour apron). Reading a precomputed value — rather than an
   * at-render finite difference of the 1px-bordered height — keeps it identical
   * across chunk seams: a per-chunk finite diff clamps differently at each edge.
   */
  slopeAt(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return clamp01(bilinear(this.data.slopeMapBordered, this.bs, fx, fy));
  }

  sampleSlope(u: number, v: number): number {
    const { fx, fy } = this.uvToPixel(u, v);
    return bilinear(this.data.slopeMap, this.size, fx, fy);
  }

  /** Seamless moisture (0..1) from the bordered map — feeds the continuous masks. */
  sampleMoisture(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.moistureMapBordered, this.bs, fx, fy);
  }

  /** Seamless temperature (0..1) from the bordered map — feeds the continuous masks. */
  sampleTemperature(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.temperatureMapBordered, this.bs, fx, fy);
  }

  /** Seamless river intensity from the bordered map — valley-carve input. */
  sampleRiver(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.riverMapBordered, this.bs, fx, fy);
  }

  /** Seamless flow accumulation from the bordered map — valley-width input. */
  sampleFlow(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.flowAccumulationMapBordered, this.bs, fx, fy);
  }

  /** Seamless lake depth from the bordered map — lake-basin/gate input. */
  sampleLake(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.lakeMapBordered, this.bs, fx, fy);
  }

  /** Seamless distance-to-water (0..1) from the bordered map — shore-flatten gate. */
  sampleWaterDistance(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.waterDistanceMapBordered, this.bs, fx, fy);
  }

  sampleShore(u: number, v: number): number {
    const { fx, fy } = this.uvToPixel(u, v);
    return bilinear(this.data.shoreMap, this.size, fx, fy);
  }

  sampleVegetationDensity(u: number, v: number): number {
    const { fx, fy } = this.uvToPixel(u, v);
    return bilinear(this.data.vegetationDensityMap, this.size, fx, fy);
  }

  /** Seamless water surface from the bordered map — lake-basin clamp target. */
  sampleWaterSurface(u: number, v: number): number {
    const fx = u * this.size + 0.5;
    const fy = v * this.size + 0.5;
    return bilinear(this.data.waterSurfaceMapBordered, this.bs, fx, fy);
  }

  /** Nearest biome id (discrete; used for colour + placement, not geometry). */
  sampleBiome(u: number, v: number): number {
    const px = Math.min(this.size - 1, Math.max(0, Math.round(u * this.size - 0.5)));
    const py = Math.min(this.size - 1, Math.max(0, Math.round(v * this.size - 0.5)));
    return this.data.biomeMap[py * this.size + px] ?? 0;
  }

  /** 1 where a water surface should render at this cell, else 0 (nearest). */
  waterMaskAt(u: number, v: number): number {
    const px = Math.min(this.size - 1, Math.max(0, Math.round(u * this.size - 0.5)));
    const py = Math.min(this.size - 1, Math.max(0, Math.round(v * this.size - 0.5)));
    return this.data.waterMask[py * this.size + px] ?? 0;
  }

  worldToUv(wx: number, wy: number): { u: number; v: number } {
    return { u: (wx - this.originX) / this.size, v: (wy - this.originY) / this.size };
  }
}
