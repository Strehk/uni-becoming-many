// ── Becoming Many — Per-pixel Biome Classification ─────────────
//
// Classification driven by the continuous fields (height, temperature, moisture,
// slope, shore, water) rather than macro WFC cells, so biome boundaries are soft
// and follow terrain. Vegetation follows biome, moisture, slope and a tree line,
// with seamless world-space noise variation.
//
// PURE CPU — no three, no DOM.

import { Biome, type ChunkData, type GenParams, MacroTile } from "./mapTypes.ts";
import { valueNoise2D } from "./noise.ts";

const VEG_BASE: number[] = (() => {
  const v = new Array<number>(14).fill(0);
  v[Biome.Forest] = 0.95;
  v[Biome.Taiga] = 0.7;
  v[Biome.Wetland] = 0.65;
  v[Biome.Grassland] = 0.5;
  v[Biome.Hills] = 0.42;
  v[Biome.Tundra] = 0.18;
  v[Biome.RockyMountain] = 0.12;
  v[Biome.Beach] = 0.06;
  v[Biome.Desert] = 0.05;
  v[Biome.SnowMountain] = 0.0;
  return v;
})();

const LAND_BIOMES = [
  Biome.Grassland,
  Biome.Forest,
  Biome.Wetland,
  Biome.Desert,
  Biome.Hills,
  Biome.RockyMountain,
  Biome.SnowMountain,
  Biome.Tundra,
  Biome.Taiga,
] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const x = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return x * x * (3 - 2 * x);
};

function biomeFrequency(biome: Biome, params: GenParams): number {
  switch (biome) {
    case Biome.Ocean:
      return Math.max(0, params.biomeOceanFrequency);
    case Biome.Coast:
      return Math.max(0, params.biomeCoastFrequency);
    case Biome.Beach:
      return Math.max(0, params.biomeBeachFrequency);
    case Biome.Grassland:
      return Math.max(0, params.biomeGrasslandFrequency);
    case Biome.Forest:
      return Math.max(0, params.biomeForestFrequency);
    case Biome.Wetland:
      return Math.max(0, params.biomeWetlandFrequency);
    case Biome.Desert:
      return Math.max(0, params.biomeDesertFrequency);
    case Biome.Hills:
      return Math.max(0, params.biomeHillsFrequency);
    case Biome.RockyMountain:
      return Math.max(0, params.biomeRockyMountainFrequency);
    case Biome.SnowMountain:
      return Math.max(0, params.biomeSnowMountainFrequency);
    case Biome.Lake:
      return Math.max(0, params.biomeLakeFrequency);
    case Biome.River:
      return Math.max(0, params.biomeRiverFrequency);
    case Biome.Tundra:
      return Math.max(0, params.biomeTundraFrequency);
    case Biome.Taiga:
      return Math.max(0, params.biomeTaigaFrequency);
  }
}

/** Field suitability used when frequency controls expand one land biome into a
 * neighbouring compatible climate/elevation zone. All values stay in 0..1. */
function landSuitability(
  biome: (typeof LAND_BIOMES)[number],
  height: number,
  moisture: number,
  temperature: number,
  slope: number,
  waterLevel: number,
): number {
  const land = smoothstep(waterLevel, waterLevel + 0.06, height);
  const lowland = 1 - smoothstep(0.68, 0.86, height);
  const flat = 1 - smoothstep(0.32, 0.82, slope);
  const wet = smoothstep(0.4, 0.78, moisture);
  const dry = 1 - smoothstep(0.18, 0.48, moisture);
  const warm = smoothstep(0.28, 0.68, temperature);
  const cold = 1 - smoothstep(0.12, 0.48, temperature);

  switch (biome) {
    case Biome.Grassland:
      return land * lowland * (0.5 + flat * 0.5) * (0.65 + (1 - Math.abs(moisture - 0.45)) * 0.35);
    case Biome.Forest:
      return land * lowland * wet * smoothstep(0.18, 0.45, temperature) * (0.45 + flat * 0.55);
    case Biome.Wetland:
      return land * wet * flat * (1 - smoothstep(waterLevel + 0.08, waterLevel + 0.24, height));
    case Biome.Desert:
      return land * lowland * dry * warm * (0.45 + flat * 0.55);
    case Biome.Hills:
      return land * smoothstep(0.52, 0.68, height) * (1 - smoothstep(0.78, 0.94, height));
    case Biome.RockyMountain:
      return land * smoothstep(0.66, 0.86, height) * (0.55 + slope * 0.45);
    case Biome.SnowMountain:
      return land * smoothstep(0.7, 0.9, height) * cold;
    case Biome.Tundra:
      return land * lowland * cold * (0.55 + flat * 0.45);
    case Biome.Taiga:
      return land * lowland * (1 - warm) * (0.35 + wet * 0.65);
  }
}

/**
 * Relative frequency selection for land biomes. The authored base biome gets a
 * 1.3× incumbent bonus, so all sliders at 1 reproduce the old classifier
 * exactly. Raising one frequency above 1 expands it organically into suitable
 * neighbours; lowering it lets those neighbours replace it.
 */
function applyLandFrequency(
  base: (typeof LAND_BIOMES)[number],
  params: GenParams,
  height: number,
  moisture: number,
  temperature: number,
  slope: number,
  worldX: number,
  worldY: number,
): Biome {
  let best: Biome = base;
  let bestScore = biomeFrequency(base, params) * 1.3;
  const scale = 0.006 / Math.max(0.2, params.biomeScale);
  for (const candidate of LAND_BIOMES) {
    if (candidate === base) continue;
    const frequency = biomeFrequency(candidate, params);
    if (frequency <= 0) continue;
    const suitability = landSuitability(
      candidate,
      height,
      moisture,
      temperature,
      slope,
      params.waterLevel,
    );
    const variation =
      0.9 + valueNoise2D(worldX * scale, worldY * scale, params.seed + candidate * 1597) * 0.3;
    // Frequency is deliberately non-linear: the useful slider range is 0..3,
    // and values above 1 must be able to expand a biome beyond its ideal core
    // without turning completely unsuitable climates into it.
    const affinity = 0.2 + suitability * 0.8;
    const score = affinity * frequency ** 1.6 * variation;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isFrequencyControlledLand(biome: Biome): biome is (typeof LAND_BIOMES)[number] {
  switch (biome) {
    case Biome.Grassland:
    case Biome.Forest:
    case Biome.Wetland:
    case Biome.Desert:
    case Biome.Hills:
    case Biome.RockyMountain:
    case Biome.SnowMountain:
    case Biome.Tundra:
    case Biome.Taiga:
      return true;
    default:
      return false;
  }
}

export function classifyChunk(
  chunk: ChunkData,
  params: GenParams,
  originX: number,
  originY: number,
): void {
  const size = chunk.size;
  const wl = params.waterLevel;
  const { heightMap, moistureMap, temperatureMap, slopeMap, riverMap, lakeMap, shoreMap } = chunk;
  const vegSeed = (params.seed ^ 0x7e57) >>> 0;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const h = heightMap[i] ?? 0;
      const m = moistureMap[i] ?? 0;
      const t = temperatureMap[i] ?? 0;
      const s = slopeMap[i] ?? 0;
      const shore = shoreMap[i] ?? 0;

      let b: Biome;
      const coastDepth = Math.min(0.14, 0.04 * biomeFrequency(Biome.Coast, params));
      const beachFrequency = biomeFrequency(Biome.Beach, params);
      const beachWidth = 0.012 * Math.min(3, beachFrequency);
      const beachShoreThreshold = Math.max(0.12, 0.5 - (beachFrequency - 1) * 0.16);
      if ((lakeMap[i] ?? 0) > 0.12) b = Biome.Lake;
      else if ((riverMap[i] ?? 0) > 0.18) b = Biome.River;
      else if (h < wl - coastDepth) b = Biome.Ocean;
      else if (h < wl) b = coastDepth > 0 ? Biome.Coast : Biome.Ocean;
      else if (beachFrequency > 0 && shore > beachShoreThreshold && h < wl + beachWidth) {
        b = Biome.Beach;
      } else if (h > 0.83 && t < 0.45) b = Biome.SnowMountain;
      else if (h > 0.75) b = Biome.RockyMountain;
      else if (h > 0.62) b = t < 0.22 ? Biome.Taiga : Biome.Hills;
      else if (t < 0.12) b = Biome.Tundra;
      else if (m > 0.6 && h < wl + 0.08) b = Biome.Wetland;
      else if (m < 0.3 && t > 0.55) b = Biome.Desert;
      else if (m > 0.52) b = t < 0.28 ? Biome.Taiga : Biome.Forest;
      else b = Biome.Grassland;

      if (isFrequencyControlledLand(b)) {
        b = applyLandFrequency(b, params, h, m, t, s, originX + px, originY + py);
      }

      chunk.biomeMap[i] = b;
      writeVegetation(chunk, i, b, m, s, h, originX + px, originY + py, params, vegSeed);
    }
  }
}

/** Base land biome authored by a macro WFC tile (Pass A). Water/beach/peak edges
 *  are refined per-pixel from the fields in {@link classifyChunkFromMacro}. */
function macroToBiome(tile: number): Biome {
  switch (tile) {
    case MacroTile.Ocean:
      return Biome.Ocean;
    case MacroTile.Coast:
      return Biome.Coast;
    case MacroTile.Forest:
      return Biome.Forest;
    case MacroTile.Wetland:
    case MacroTile.LakeCandidate:
      return Biome.Wetland;
    case MacroTile.Desert:
      return Biome.Desert;
    case MacroTile.Hills:
    case MacroTile.RiverSource:
      return Biome.Hills;
    case MacroTile.RockyMountain:
      return Biome.RockyMountain;
    case MacroTile.SnowMountain:
      return Biome.SnowMountain;
    default:
      return Biome.Grassland; // Lowland, Grassland, RiverCorridor
  }
}

/**
 * Per-pixel biome where the mid-land biome is authored by the Pass A macro WFC
 * tile (so biomes read as WFC blocks with soft edges), while water/beach/peak/cold
 * boundaries are refined from the continuous fields (macro cells are too coarse for
 * coastlines and summits). Requires `chunk.macroMap` to be stamped already.
 */
export function classifyChunkFromMacro(
  chunk: ChunkData,
  params: GenParams,
  originX: number,
  originY: number,
): void {
  const size = chunk.size;
  const wl = params.waterLevel;
  const {
    heightMap,
    moistureMap,
    temperatureMap,
    slopeMap,
    riverMap,
    lakeMap,
    shoreMap,
    macroMap,
  } = chunk;
  const vegSeed = (params.seed ^ 0x7e57) >>> 0;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const h = heightMap[i] ?? 0;
      const m = moistureMap[i] ?? 0;
      const t = temperatureMap[i] ?? 0;
      const s = slopeMap[i] ?? 0;
      const shore = shoreMap[i] ?? 0;

      let b = macroToBiome(macroMap[i] ?? 0);
      const coastDepth = Math.min(0.14, 0.04 * biomeFrequency(Biome.Coast, params));
      const beachFrequency = biomeFrequency(Biome.Beach, params);
      const beachWidth = 0.012 * Math.min(3, beachFrequency);
      const beachShoreThreshold = Math.max(0.12, 0.5 - (beachFrequency - 1) * 0.16);
      if ((lakeMap[i] ?? 0) > 0.12) b = Biome.Lake;
      else if ((riverMap[i] ?? 0) > 0.18) b = Biome.River;
      else if (h < wl - coastDepth) b = Biome.Ocean;
      else if (h < wl) b = coastDepth > 0 ? Biome.Coast : Biome.Ocean;
      else if (beachFrequency > 0 && shore > beachShoreThreshold && h < wl + beachWidth) {
        b = Biome.Beach;
      } else if (h > 0.83 && t < 0.45) b = Biome.SnowMountain;
      else if (h > 0.75) b = Biome.RockyMountain;
      else if (t < 0.22) b = Biome.Tundra;
      else if (b === Biome.Forest && t < 0.35) b = Biome.Taiga;

      if (isFrequencyControlledLand(b)) {
        b = applyLandFrequency(b, params, h, m, t, s, originX + px, originY + py);
      }

      chunk.biomeMap[i] = b;
      writeVegetation(chunk, i, b, m, s, h, originX + px, originY + py, params, vegSeed);
    }
  }
}

/** Shared vegetation-density write (biome affinity × moisture × slope × tree line). */
function writeVegetation(
  chunk: ChunkData,
  i: number,
  b: Biome,
  moisture: number,
  slope: number,
  h: number,
  wx: number,
  wy: number,
  params: GenParams,
  vegSeed: number,
): void {
  const variation = 0.6 + 0.4 * valueNoise2D(wx * 0.04, wy * 0.04, vegSeed);
  let veg = (VEG_BASE[b] ?? 0) * (0.45 + moisture * 0.75) * (1 - slope * 0.75) * variation;
  veg *= params.vegetationDensity;
  if (h > 0.78) veg *= Math.max(0, Math.min(1, (0.86 - h) / 0.1)); // tree line
  chunk.vegetationDensityMap[i] = Math.max(0, Math.min(1, veg));
}
