// ── Becoming Many — Continuous Field Library ───────────────────
//
// CPU field library (domain warp → continent fbm → land mask → ridged mountains;
// climate + lapse; moisture). Every function is a pure function of world position
// + seed, which keeps region/chunk borders seamless. Per-seed variation comes
// ONLY from a coordinate offset (`seedToOffset`), never from reseeding the noise.
//
// PURE CPU — no three, no DOM.

import type { GenParams } from "./mapTypes.ts";
import { signedFbm2D, valueNoise2D } from "./noise.ts";

// Fixed per-channel seeds. World variation is the coordinate offset, so these are
// constants that only separate the noise channels from one another.
const S_WARP_X = 1301;
const S_WARP_Y = 3107;
const S_CONTINENT = 2011;
const S_BROAD = 2027;
const S_RIDGE = 3001;
const S_DETAIL = 4051;
const S_CLIMATE = 5023;
const S_GRAD = 5039;
const S_MOIST = 6067;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed fBM in ~[-1,1]. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  return signedFbm2D(x, y, seed, octaves);
}

/** Ridged multifractal in ~[0,1] with sharp crests. */
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
 * Base (macro-scale) elevation in [0,1]: continents, broad relief and mountain
 * ranges, no fine detail.
 */
export function baseHeight01(
  wx: number,
  wy: number,
  seedOffset: [number, number],
  P: GenParams,
): number {
  const psx = wx + seedOffset[0];
  const psy = wy + seedOffset[1];

  // Ocean size controls the horizontal extent of sea basins independently of
  // their frequency/water coverage. Keeping the relief scale separate prevents
  // this slider from also resizing every hill and mountain.
  const oceanScale = P.continentScale * clamp(P.biomeOceanSize, 0.1, 2);

  // Domain warp at a medium scale for more organic coastlines / ranges.
  const wf = 1 / (oceanScale * 0.5);
  const warpAmp = P.domainWarpStrength * oceanScale * 0.3;
  const warpX = fbm(psx * wf + 13.1, psy * wf + 7.7, S_WARP_X, 3) * warpAmp;
  const warpY = fbm(psx * wf + 31.7, psy * wf + 19.3, S_WARP_Y, 3) * warpAmp;
  const pwx = psx + warpX;
  const pwy = psy + warpY;

  const cf = 1 / P.continentScale;
  const oceanFrequency = 1 / oceanScale;
  const continent = fbm(pwx * oceanFrequency, pwy * oceanFrequency, S_CONTINENT, 5); // ~[-0.5,0.5]
  const broad = fbm(pwx * cf * 2.5, pwy * cf * 2.5, S_BROAD, 4);
  const land = smoothstep(-0.1, 0.2, continent); // 0..1 landmass mask

  const elevation = continent + broad * 0.35; // ~[-0.7,0.7]
  const gained = elevation * (2.2 * P.heightScale);
  const e01 = clamp(gained * 0.5 + 0.5, 0, 1); // 0..1 base land shape

  // Mountains: ridged noise, only where the land is already high & inland.
  const mountainMask = smoothstep(0.55, 0.85, e01) * land;
  const ridge = ridged(pwx * cf * 4.0, pwy * cf * 4.0, S_RIDGE, 4); // [0,1]
  const mountains = ridge * P.ridgeStrength * mountainMask * P.mountainStrength * 0.5;

  return clamp(e01 + mountains, 0, 1);
}

/** Full fine height in [0,1] = base elevation + small high-frequency detail. */
export function fineHeight01(
  wx: number,
  wy: number,
  seedOffset: [number, number],
  P: GenParams,
): number {
  const base = baseHeight01(wx, wy, seedOffset, P);
  const psx = wx + seedOffset[0];
  const psy = wy + seedOffset[1];
  const df = 1 / Math.max(20, P.noiseScale);
  const landMask = smoothstep(P.waterLevel - 0.02, P.waterLevel + 0.06, base);
  const detail = fbm(psx * df, psy * df, S_DETAIL, 4) * 0.035 * landMask;
  return clamp(base + detail, 0, 1);
}

/** Temperature in [0,1]: broad climate + low-frequency gradient − elevation lapse. */
export function temperature01(
  wx: number,
  wy: number,
  seedOffset: [number, number],
  P: GenParams,
): number {
  const psx = wx + seedOffset[0] + 9123.5;
  const psy = wy + seedOffset[1] - 4567.5;
  const climate =
    fbm(psx / (P.continentScale * 3), psy / (P.continentScale * 3), S_CLIMATE, 3) * 0.5 + 0.5;
  const grad =
    fbm(psx / (P.continentScale * 8), psy / (P.continentScale * 8), S_GRAD, 2) *
    (P.temperatureGradient * 0.5);
  const height = baseHeight01(wx, wy, seedOffset, P);
  // Lapse anchored to a FIXED reference (not waterLevel) and softened (0.85 → 0.5)
  // so only genuinely high ground cools: dropping the sea level no longer chills the
  // whole world, which was flooding the map with tundra/taiga.
  const lapse = clamp(height - 0.45, 0, 1) * 0.5;
  return clamp(climate + grad - lapse, 0, 1);
}

/** Base moisture in [0,1] from broad noise, slightly drier at altitude. */
export function baseMoisture01(
  wx: number,
  wy: number,
  seedOffset: [number, number],
  P: GenParams,
): number {
  const psx = wx + seedOffset[0] - 7777.0;
  const psy = wy + seedOffset[1] + 3333.0;
  const m =
    fbm(psx / Math.max(200, P.moistureScale), psy / Math.max(200, P.moistureScale), S_MOIST, 4) *
      0.5 +
    0.5;
  const height = baseHeight01(wx, wy, seedOffset, P);
  const dryHigh = clamp(height - 0.6, 0, 1) * 0.3;
  return clamp(Math.max(m - dryHigh, 0), 0, 1);
}
