// ── Becoming Many — Macro World Generator (Pass A + drainage) ──
//
// Builds the macro plan + drainage substrate for one region:
//   1. Samples band-limited base height on a 3×3-region block so drainage sees a
//      full ring of neighbours (rivers entering from neighbours are captured and
//      flow/lakes are near-exact across seams).
//   2. Runs WFC over the region interior (Pass A) for the macro tile plan.
//   3. Priority-flood + flow accumulation + lake/river extraction on the block,
//      storing the interior fields and the river polylines that pass through it.
//   4. Runs Pass B (per-biome landform WFC) over the meso grid.
//
// PURE CPU — no three, no DOM.

import { baseHeight01, baseMoisture01, temperature01 } from "../fields.ts";
import { priorityFlood } from "../hydrology/lakes/BasinDetection.ts";
import { detectLakes } from "../hydrology/lakes/LakeGenerator.ts";
import { flowAccumulation } from "../hydrology/rivers/FlowAccumulation.ts";
import { emptyNetwork } from "../hydrology/rivers/RiverNetwork.ts";
import { traceRivers } from "../hydrology/rivers/RiverTracing.ts";
import { type GenParams, MACRO_TILE_COUNT, type RegionData } from "../mapTypes.ts";
import { deriveSeed, mulberry32, seedToOffset } from "../rng.ts";
import { WfcSolver } from "../wfc/WfcSolver.ts";
import {
  COMPAT_MASK,
  FULL_DOMAIN,
  argmaxTile,
  tilePriors,
  uplandSourceAllowed,
} from "../wfc/biomeConstraints.ts";
import { buildLandformPlan } from "./LandformPlan.ts";

export class MacroWorldGenerator {
  private solver = new WfcSolver();

  // Kept async (CPU now, no await) so RegionManager's promise-cache path is
  // unchanged — region generation could move off the critical path later.
  async generate(rx: number, ry: number, params: GenParams): Promise<RegionData> {
    const RM = params.macroResolution;
    const cs = params.macroCellSize;
    const seaLevel = params.waterLevel;
    const BW = 3 * RM; // block width/height (region + 1-ring of neighbours)
    const blockOriginMx = (rx - 1) * RM;
    const blockOriginMy = (ry - 1) * RM;

    // Sample height/temp/moisture over the whole 3×3 block. Macro cell (lx,ly)
    // samples world ((blockOriginMx+lx+0.5)*cs, …).
    const seedOffset = seedToOffset(params.seed);
    const blockHeight = new Float32Array(BW * BW);
    const blockTemp = new Float32Array(BW * BW);
    const blockMoist = new Float32Array(BW * BW);
    for (let ly = 0; ly < BW; ly++) {
      for (let lx = 0; lx < BW; lx++) {
        const wx = (blockOriginMx + lx + 0.5) * cs;
        const wy = (blockOriginMy + ly + 0.5) * cs;
        const i = ly * BW + lx;
        blockHeight[i] = baseHeight01(wx, wy, seedOffset, params);
        blockTemp[i] = temperature01(wx, wy, seedOffset, params);
        blockMoist[i] = baseMoisture01(wx, wy, seedOffset, params);
      }
    }

    // Per-block upland-source mask (WFC riverSource hint as a pure function).
    const srcAllowed = new Uint8Array(BW * BW);
    for (let i = 0; i < srcAllowed.length; i++) {
      const h = blockHeight[i] ?? 0;
      const t = blockTemp[i] ?? 0;
      const m = blockMoist[i] ?? 0;
      srcAllowed[i] = uplandSourceAllowed(h, t, m) ? 1 : 0;
    }

    // Extract the region interior (RM×RM) for WFC priors + storage.
    const n = RM * RM;
    const macroHeight = new Float32Array(n);
    const macroTemp = new Float32Array(n);
    const macroMoisture = new Float32Array(n);
    for (let ly = 0; ly < RM; ly++) {
      for (let lx = 0; lx < RM; lx++) {
        const bi = (RM + ly) * BW + (RM + lx);
        const i = ly * RM + lx;
        macroHeight[i] = blockHeight[bi] ?? 0;
        macroTemp[i] = blockTemp[bi] ?? 0;
        macroMoisture[i] = blockMoist[bi] ?? 0;
      }
    }

    // ── WFC macro plan (Pass A) ──
    const priors = new Float32Array(n * MACRO_TILE_COUNT);
    const pinned = new Int16Array(n).fill(-1);
    for (let ly = 0; ly < RM; ly++) {
      for (let lx = 0; lx < RM; lx++) {
        const i = ly * RM + lx;
        const h = macroHeight[i] ?? 0;
        const t = macroTemp[i] ?? 0;
        const m = macroMoisture[i] ?? 0;
        priors.set(tilePriors(h, t, m), i * MACRO_TILE_COUNT);
        if (lx === 0 || ly === 0 || lx === RM - 1 || ly === RM - 1) {
          pinned[i] = argmaxTile(h, t, m);
        }
      }
    }
    const rng = mulberry32(deriveSeed(params.seed, rx, ry, 0x5fc));
    const macroTiles = this.solver.solve({
      w: RM,
      h: RM,
      tileCount: MACRO_TILE_COUNT,
      compatMask: COMPAT_MASK,
      fullDomain: FULL_DOMAIN,
      priors,
      pinned,
      rng,
    });

    // ── Drainage on the block ──
    const NB = BW * BW;
    const { filled, receiver } = priorityFlood(blockHeight, BW, BW);
    const accum = flowAccumulation(filled, receiver, NB);
    // Lakes/rivers can be excluded from generation (params.lakesEnabled /
    // riversEnabled). When off, their fields stay empty (zero depth, no polylines)
    // so every downstream stamp is a no-op — the drainage substrate (filled/accum)
    // is still computed since Pass B relief and biome classification read it.
    const lakes = params.lakesEnabled
      ? detectLakes(
          blockHeight,
          filled,
          receiver,
          NB,
          seaLevel,
          params.lakeSpillTolerance,
          params.lakeFrequency,
          params.lakeMaxHeight,
        )
      : { lakeDepth: new Float32Array(NB), lakeSurface: new Float32Array(NB), spillIdx: [] };
    const lakeMask = new Uint8Array(NB);
    for (let i = 0; i < NB; i++) lakeMask[i] = (lakes.lakeDepth[i] ?? 0) > 0 ? 1 : 0;

    const rectMinX = rx * RM * cs;
    const rectMinY = ry * RM * cs;
    const rectMaxX = (rx + 1) * RM * cs;
    const rectMaxY = (ry + 1) * RM * cs;
    const rivers = params.riversEnabled
      ? traceRivers({
          filled,
          receiver,
          accum,
          lakeMask,
          srcAllowed,
          W: BW,
          H: BW,
          blockOriginMx,
          blockOriginMy,
          cs,
          seaLevel,
          rectMinX,
          rectMinY,
          rectMaxX,
          rectMaxY,
          params,
          seed: deriveSeed(params.seed, rx, ry, 0x917) >>> 0,
        })
      : emptyNetwork();

    // Extract interior drainage fields + normalise accumulation (log scale).
    const macroFilled = new Float32Array(n);
    const macroAccum = new Float32Array(n);
    const lakeDepth = new Float32Array(n);
    const lakeSurface = new Float32Array(n);
    let maxA = 1;
    for (let ly = 0; ly < RM; ly++) {
      for (let lx = 0; lx < RM; lx++) {
        const a = accum[(RM + ly) * BW + (RM + lx)] ?? 0;
        if (a > maxA) maxA = a;
      }
    }
    const logMax = Math.log(1 + maxA);
    for (let ly = 0; ly < RM; ly++) {
      for (let lx = 0; lx < RM; lx++) {
        const bi = (RM + ly) * BW + (RM + lx);
        const i = ly * RM + lx;
        macroFilled[i] = filled[bi] ?? 0;
        macroAccum[i] = Math.log(1 + (accum[bi] ?? 0)) / logMax;
        lakeDepth[i] = lakes.lakeDepth[bi] ?? 0;
        lakeSurface[i] = lakes.lakeSurface[bi] ?? 0;
      }
    }

    const spillPoints: { x: number; y: number }[] = [];
    for (const bi of lakes.spillIdx) {
      const gx = bi % BW;
      const gy = (bi / BW) | 0;
      const wx = (blockOriginMx + gx + 0.5) * cs;
      const wy = (blockOriginMy + gy + 0.5) * cs;
      if (wx >= rectMinX && wx < rectMaxX && wy >= rectMinY && wy < rectMaxY) {
        spillPoints.push({ x: wx, y: wy });
      }
    }

    // ── Pass B — per-biome landform WFC over a finer meso grid ──
    const landform = buildLandformPlan(rx, ry, params, macroTiles, this.solver);

    return {
      rx,
      ry,
      macroW: RM,
      macroH: RM,
      macroCellSize: cs,
      macroTiles,
      macroHeight,
      macroTemp,
      macroMoisture,
      macroFilled,
      macroAccum,
      lakeDepth,
      lakeSurface,
      rivers,
      spillPoints,
      landformTiles: landform.tiles,
      landformElevation: landform.elevation,
      mesoSubdiv: landform.m,
    };
  }
}
