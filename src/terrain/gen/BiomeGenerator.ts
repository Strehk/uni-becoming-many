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
      if ((lakeMap[i] ?? 0) > 0.12) b = Biome.Lake;
      else if ((riverMap[i] ?? 0) > 0.18) b = Biome.River;
      else if (h < wl - 0.04) b = Biome.Ocean;
      else if (h < wl) b = Biome.Coast;
      else if (shore > 0.5 && h < wl + 0.012) b = Biome.Beach;
      else if (h > 0.83 && t < 0.45) b = Biome.SnowMountain;
      else if (h > 0.75) b = Biome.RockyMountain;
      else if (h > 0.62) b = t < 0.22 ? Biome.Taiga : Biome.Hills;
      else if (t < 0.12) b = Biome.Tundra;
      else if (m > 0.6 && h < wl + 0.08) b = Biome.Wetland;
      else if (m < 0.3 && t > 0.55) b = Biome.Desert;
      else if (m > 0.52) b = t < 0.28 ? Biome.Taiga : Biome.Forest;
      else b = Biome.Grassland;

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
      if ((lakeMap[i] ?? 0) > 0.12) b = Biome.Lake;
      else if ((riverMap[i] ?? 0) > 0.18) b = Biome.River;
      else if (h < wl - 0.04) b = Biome.Ocean;
      else if (h < wl) b = Biome.Coast;
      else if (shore > 0.5 && h < wl + 0.012) b = Biome.Beach;
      else if (h > 0.83 && t < 0.45) b = Biome.SnowMountain;
      else if (h > 0.75) b = Biome.RockyMountain;
      else if (t < 0.22) b = Biome.Tundra;
      else if (b === Biome.Forest && t < 0.35) b = Biome.Taiga;

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
