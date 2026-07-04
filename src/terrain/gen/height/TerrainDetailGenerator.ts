// ── Becoming Many — 3D Detail Layer ────────────────────────────
//
// The Stage 1 height map is a coarse PLAN. This turns it into believable 3D
// terrain by ADDING local relief the macro map cannot hold — without ever
// contradicting the plan:
//
//   finalHeight = macroHeight + biome detail + mountain ridge detail
//               + cliff detail + micro noise + river valley carving
//               + lake-basin clamp + shore flattening
//
// Everything is a pure function of world (x,y) + seed → seam-free. PURE CPU.

import type { GenParams } from "../mapTypes.ts";
import { fbm2D, signedFbm2D, valueNoise2D } from "../noise.ts";
import { computeMasks, smoothstep } from "./BiomeTerrainProfiles.ts";
import type { TerrainSampler } from "./TerrainSampler.ts";

/** Ridged multifractal in ~[0,1] with sharp crests (world-space, seamless). */
function ridged(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise2D(x * freq, y * freq, seed + o * 1709) * 2 - 1;
    const r = 1 - Math.abs(n);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Normalised height → world Y. Shared by terrain AND every water mesh so surfaces
 * always line up with the bed. NON-LINEAR above sea level: land elevation is
 * raised to `reliefExponent`, flattening lowlands and making high ground tower.
 */
export function heightToWorldY(heightNorm: number, params: GenParams): number {
  const sea = params.waterLevel;
  const reliefMax = params.terrainHeightScale;
  if (heightNorm <= sea) {
    return (heightNorm - sea) * reliefMax * 0.5; // gentle ocean floor (negative)
  }
  const landNorm = (heightNorm - sea) / (1 - sea); // 0 at shore, 1 at macro max, can exceed 1
  return landNorm ** params.reliefExponent * reliefMax;
}

/** Rich per-point result, reused by the mesh builder, material and placement. */
export interface TerrainPoint {
  heightNorm: number; // detailed normalised height (0..1)
  y: number; // world Y
  macroHeight: number; // the Stage 1 plan height at this point
  slope: number; // seamless slope 0..1
  mountain: number; // mountain mask 0..1
  rock: number; // rock exposure 0..1 (slope/biome driven)
  wetness: number; // proximity-to-water wetness 0..1
}

export class TerrainDetailGenerator {
  private params: GenParams;
  private seed: number;

  constructor(params: GenParams) {
    this.params = params;
    this.seed = params.seed >>> 0;
  }

  setParams(params: GenParams): void {
    this.params = params;
    this.seed = params.seed >>> 0;
  }

  /** Detailed normalised height at a world position. */
  heightAt(wx: number, wy: number, s: TerrainSampler): number {
    return this.evaluate(wx, wy, s).heightNorm;
  }

  /** World-space Y at a world position. */
  worldY(wx: number, wy: number, s: TerrainSampler): number {
    return this.evaluate(wx, wy, s).y;
  }

  /** Full evaluation (height + the masks the material/placement want). */
  evaluate(wx: number, wy: number, s: TerrainSampler): TerrainPoint {
    const P = this.params;
    const sea = P.waterLevel;
    const seed = this.seed;
    const u = (wx - s.originX) / s.size;
    const v = (wy - s.originY) / s.size;

    // Blend the Pass B landform elevation over the field-noise relief by
    // `heightWfcStrength` (0 = pure noise baseline, 1 = WFC landform dominant).
    // Both are seamless (bordered) → the blend stays crack-free across chunks.
    const fieldsH = s.sampleHeight(u, v);
    const landformH = s.sampleLandformHeight(u, v);
    const macroH = fieldsH + (landformH - fieldsH) * P.heightWfcStrength;
    const slope = s.slopeAt(u, v);
    const moisture = s.sampleMoisture(u, v);
    const temperature = s.sampleTemperature(u, v);
    const river = s.sampleRiver(u, v);
    const lake = s.sampleLake(u, v);
    const waterDist = s.sampleWaterDistance(u, v);

    const m = computeMasks(macroH, moisture, temperature, sea);

    // Gates ------------------------------------------------------------------
    const landGate = smoothstep(sea - 0.01, sea + 0.03, macroH); // 0 under sea
    const waterFeature = Math.max(Math.min(1, lake * 1.4), Math.min(1, river * 1.6));
    // Flatten toward water: full detail far away, smoothing in near shores/banks.
    const shoreGate = smoothstep(0.0, 0.1, waterDist);
    const shoreBlend = 1 - P.shoreSmoothing * (1 - shoreGate);
    const detailGate = landGate * (1 - waterFeature) * Math.max(0, shoreBlend);

    // Noise terms (normalised height units) ----------------------------------
    const ds = P.detailStrength;

    const rollAmp =
      (m.hill * 0.05 + m.lowland * 0.022) * (1 - m.wetland * 0.85) * (1 - m.desert * 0.8);
    const rolling = (fbm2D(wx / 95, wy / 95, seed + 101, 4) - 0.5) * 2 * rollAmp;

    const duneDir = wx * 0.7 + wy * 0.7;
    const dune =
      (Math.sin(duneDir / 26 + fbm2D(wx / 180, wy / 180, seed + 202, 2) * 3.0) * 0.5 + 0.5) *
      m.desert *
      0.03;

    const rs = P.mountainRidgeStrength;
    const massif = ridged(wx / 720, wy / 720, seed + 707, 3) * m.mountain * 0.16 * rs;
    const crests = ridged(wx / 190, wy / 190, seed + 303, 5) * m.mountain * 0.26 * rs;
    const ridge = massif + crests;

    const steep = smoothstep(P.rockSlopeThreshold, P.rockSlopeThreshold + 0.25, slope);
    const rockZone = Math.max(steep, m.mountain * 0.6);
    const cliffAmp = rockZone * 0.06 * P.cliffStrength;
    const cliff = (ridged(wx / 38, wy / 38, seed + 404, 3) - 0.4) * cliffAmp;

    const micro = signedFbm2D(wx / 11, wy / 11, seed + 505, 3) * 0.0035;

    // The big mountain ridge/cliff terms ride on `landGate` (so massifs can tower),
    // which bypasses the water-flattening `detailGate`. Gate them out of the lake
    // footprint so the bed stays a clean basin while mountains still rise on land.
    const lakeGate = 1 - smoothstep(0.05, 0.3, lake);

    let detail =
      (rolling + dune + micro) * detailGate * ds +
      ridge * landGate * lakeGate * ds +
      cliff * landGate * lakeGate * ds;

    // River valley: deepen + widen a visible 3D valley around the channel.
    const flow = s.sampleFlow(u, v);
    const channel = smoothstep(0.04, 0.45, river);
    const valley = channel * (0.012 + flow * 0.05) * P.riverValleyStrength;
    detail -= valley;

    let heightNorm = macroH + detail;

    // Lake basin: clamp the bed below the flat lake surface so lakes are real
    // basins with no terrain spikes poking through the water.
    if (lake > 0.08) {
      const surf = s.sampleWaterSurface(u, v);
      const basinDepth = 0.01 + lake * 0.025;
      const targetBed = surf - basinDepth;
      const k = Math.min(1, lake * 1.3);
      heightNorm = heightNorm + (Math.min(heightNorm, targetBed) - heightNorm) * k;
    }

    // Lower-clamp only. Upper bound intentionally loose (NOT 1.0) so ridge detail
    // can push past the macro max and build real peaks.
    if (heightNorm < 0) heightNorm = 0;
    else if (heightNorm > 1.8) heightNorm = 1.8;

    const rock = Math.min(1, Math.max(steep, m.mountain * smoothstep(0.7, 0.95, m.landNorm) * 0.8));
    const wetness = Math.min(1, (1 - waterDist) * 0.9 + waterFeature * 0.6);

    return {
      heightNorm,
      y: heightToWorldY(heightNorm, P),
      macroHeight: macroH,
      slope,
      mountain: m.mountain,
      rock,
      wetness,
    };
  }
}
