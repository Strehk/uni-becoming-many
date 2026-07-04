// ── Becoming Many — World Generation Data Model ────────────────
//
// Core data model for the world generator. All maps are typed arrays (the
// authoritative source of truth). Everything is keyed off integer chunk indices
// so the world can grow forever as the player flies.
//
// PURE CPU — no three, no DOM. Worker-safe (see AGENT.md modularity contract).

export enum Biome {
  Ocean = 0,
  Coast = 1, // shallow water / shoreline water
  Beach = 2,
  Grassland = 3,
  Forest = 4,
  Wetland = 5,
  Desert = 6,
  Hills = 7,
  RockyMountain = 8,
  SnowMountain = 9,
  Lake = 10,
  River = 11,
  Tundra = 12,
  Taiga = 13,
}

export const BIOME_COUNT = 14;

/** Macro WFC tile families that plan the large-scale structure (Pass A). */
export enum MacroTile {
  Ocean = 0,
  Coast = 1,
  Lowland = 2,
  Grassland = 3,
  Forest = 4,
  Wetland = 5,
  Desert = 6,
  Hills = 7,
  RockyMountain = 8,
  SnowMountain = 9,
  LakeCandidate = 10,
  RiverSource = 11,
  RiverCorridor = 12,
}

export const MACRO_TILE_COUNT = 13;

/** All user-tunable generation parameters. */
export interface GenParams {
  seed: number;
  chunkSize: number; // fine pixels per chunk edge: 256 | 512 | 1024
  macroResolution: number; // macro cells per region edge (WFC grid size): 16 | 32 | 64
  macroCellSize: number; // fine pixels per macro cell

  // height
  waterLevel: number; // 0..1 sea level on the height map
  continentScale: number; // world px period of continents (larger = bigger landmasses)
  heightScale: number; // overall elevation contrast
  noiseScale: number; // base/detail feature size in world px
  domainWarpStrength: number;
  mountainStrength: number;
  ridgeStrength: number;

  // climate
  temperatureGradient: number; // north-south gradient strength
  moistureScale: number;
  biomeScale: number;

  // rivers
  riverSourceCount: number; // sources per region
  riverDensity: number; // accumulation threshold scaling
  riverMeanderStrength: number;
  riverCarvingStrength: number;
  riverWidthMultiplier: number;
  riverSourceBias: number; // 0 = pure hydrology, 1 = sources only in WFC upland
  riverMaxHeight: number; // normalised height above which rivers are not drawn

  // lakes
  lakeFrequency: number;
  lakeSpillTolerance: number;
  lakeMaxHeight: number; // normalised height above which basins are not made lakes

  // surface
  shoreWidth: number;
  vegetationDensity: number;

  // 3D view
  terrainHeightScale: number; // world units for a height of 1.0
  meshResolution: number; // grid segments per chunk edge in 3D
  streamRadius: number; // chunk-loading radius around the fly camera
  sunAzimuth: number; // degrees
  sunElevation: number; // degrees above horizon
  sunIntensity: number;
  fogDistance: number; // fog far distance (world units)
  flySpeed: number; // camera movement speed

  // height WFC (Pass B) — the per-biome landform layer.
  heightWfcStrength: number; // 0 = pure noise relief, 1 = WFC landform dominant
  mesoSubdiv: number; // m: height-tiles per macro-cell edge (meso grid = macro × m)

  // 3D detail layer — shapes the local terrain ON TOP of the macro 2D maps.
  reliefExponent: number; // land-height curve power: >1 flattens plains & makes peaks tower
  detailStrength: number; // overall local-detail amplitude multiplier
  mountainRidgeStrength: number; // ridged-noise amplitude in mountain biomes
  cliffStrength: number; // extra shaping on steep slopes / rocky biomes
  riverValleyStrength: number; // how strongly rivers carve a visible 3D valley
  riverWaterOffset: number; // world units the river surface sits above its bed
  lakeWaterOffset: number; // world units the lake surface is nudged by
  shoreSmoothing: number; // how strongly detail flattens toward water
  snowHeight: number; // normalised height where snow begins
  snowSoftness: number; // snow blend width in normalised height
  rockSlopeThreshold: number; // slope (0..1) above which rock shows through
  treeDensity: number; // vegetation instance density multiplier
  rockDensity: number; // rock instance density multiplier
}

export type ViewMode = "2d" | "3d";

export const DEFAULT_PARAMS: GenParams = {
  seed: 1337,
  chunkSize: 256,
  macroResolution: 32,
  macroCellSize: 32,

  waterLevel: 0.42,
  continentScale: 2200,
  heightScale: 1.0,
  noiseScale: 200,
  domainWarpStrength: 0.35,
  mountainStrength: 1.0,
  ridgeStrength: 0.55,

  temperatureGradient: 0.5,
  moistureScale: 900,
  biomeScale: 1.0,

  riverSourceCount: 10,
  riverDensity: 1.0,
  riverMeanderStrength: 0.5,
  riverCarvingStrength: 0.5,
  riverWidthMultiplier: 1.0,
  riverSourceBias: 0.5,
  riverMaxHeight: 0.72,

  lakeFrequency: 0.4,
  lakeSpillTolerance: 0.02,
  lakeMaxHeight: 0.74,

  shoreWidth: 0.5,
  vegetationDensity: 1.0,

  heightWfcStrength: 0.6,
  mesoSubdiv: 2,

  terrainHeightScale: 340,
  meshResolution: 96,
  streamRadius: 4,
  sunAzimuth: 135,
  sunElevation: 45,
  sunIntensity: 2.4,
  fogDistance: 2600,
  flySpeed: 220,

  reliefExponent: 2.0,
  detailStrength: 1.0,
  mountainRidgeStrength: 1.0,
  cliffStrength: 1.0,
  riverValleyStrength: 1.0,
  riverWaterOffset: 0.8,
  lakeWaterOffset: 0.0,
  shoreSmoothing: 1.0,
  snowHeight: 0.8,
  snowSoftness: 0.12,
  rockSlopeThreshold: 0.42,
  treeDensity: 1.0,
  rockDensity: 1.0,
};

/** One sample along a river polyline (world coordinates). */
export interface RiverPoint {
  x: number;
  y: number;
  flow: number; // accumulated upstream area at this point
  width: number; // channel width in world px
  depth: number; // carve depth in height units
}

export interface RiverPath {
  points: RiverPoint[];
  terminus: "ocean" | "lake" | "boundary" | "merge";
}

export interface RiverNetwork {
  paths: RiverPath[];
  sources: { x: number; y: number }[];
}

/** All per-cell maps for one chunk (apron already trimmed). */
export interface ChunkData {
  cx: number;
  cy: number;
  size: number;
  heightMap: Float32Array;
  moistureMap: Float32Array;
  temperatureMap: Float32Array;
  slopeMap: Float32Array;
  biomeMap: Uint8Array;
  riverMap: Float32Array;
  flowAccumulationMap: Float32Array;
  lakeMap: Float32Array;
  waterDistanceMap: Float32Array;
  shoreMap: Float32Array;
  vegetationDensityMap: Float32Array;
  /** Per-pixel macro tile id, for the macro debug layer. */
  macroMap: Uint8Array;
  /** Water surface height (normalised 0..1); 0 where there is no water. */
  waterSurfaceMap: Float32Array;
  /** 1 where a water surface should render, else 0. */
  waterMask: Uint8Array;
  /** Height map with a 1-pixel border of real neighbour data ((size+2)²). */
  heightMapBordered: Float32Array;
  /**
   * Pass B landform target elevation (0..1, same scale as heightMap) with a
   * 1-pixel border ((size+2)²). The detail layer blends this over the field
   * height by `heightWfcStrength`. Equals the field height when Pass B is off.
   */
  landformHeightBordered: Float32Array;
  /**
   * Slope (0..1) with a 1-pixel border ((size+2)²), computed in the worker from
   * the real-neighbour apron. The detail layer reads THIS (not an at-render finite
   * difference) so cliff/rock shaping is identical across chunk seams — a
   * per-chunk finite diff clamps differently at each edge and cracks the mesh.
   */
  slopeMapBordered: Float32Array;
  /** Moisture (0..1) with a 1-pixel border ((size+2)²) — seamless mask input. */
  moistureMapBordered: Float32Array;
  /** Temperature (0..1) with a 1-pixel border ((size+2)²) — seamless mask input. */
  temperatureMapBordered: Float32Array;
  /** Distance-to-water (0..1) with a 1-pixel border — seamless shore-flatten gate. */
  waterDistanceMapBordered: Float32Array;
  /** River intensity with a 1-pixel border — seamless valley-carve input. */
  riverMapBordered: Float32Array;
  /** Lake depth (0..1) with a 1-pixel border — seamless lake-basin/gate input. */
  lakeMapBordered: Float32Array;
  /** Flow accumulation (0..1) with a 1-pixel border — seamless valley-width input. */
  flowAccumulationMapBordered: Float32Array;
  /** Water surface (0..1) with a 1-pixel border — seamless lake-basin clamp target. */
  waterSurfaceMapBordered: Float32Array;
  /** River polylines (world coords) passing through this chunk's footprint. */
  riverPaths: RiverPoint[][];
}

/** Per-region macro plan + drainage substrate (cached by RegionManager). */
export interface RegionData {
  rx: number;
  ry: number;
  macroW: number; // = macroResolution
  macroH: number;
  macroCellSize: number;
  macroTiles: Uint8Array;
  macroHeight: Float32Array; // band-limited base height per macro cell
  macroTemp: Float32Array;
  macroMoisture: Float32Array;
  // Drainage substrate (interior RM×RM), filled in later phases.
  macroFilled?: Float32Array; // depression-filled height
  macroAccum?: Float32Array; // normalised flow accumulation 0..1
  lakeDepth?: Float32Array; // 0 = no lake, else lake depth in height units
  lakeSurface?: Float32Array; // flat water level where lakeDepth>0
  rivers?: RiverNetwork; // river polylines passing through this region
  spillPoints?: { x: number; y: number }[]; // world-space lake outlets
  /** Pass B landform tile id per meso cell (RM·m)², filled in Phase 4. */
  landformTiles?: Uint8Array;
  /** Pass B target elevation (0..1) per meso cell (RM·m)² — the tile band midpoint. */
  landformElevation?: Float32Array;
  /** Meso subdivisions per macro cell edge (m) used for the landform grids. */
  mesoSubdiv?: number;
}

/** The debug layers selectable in the UI. */
export const DEBUG_LAYERS = [
  "final",
  "height",
  "biome",
  "moisture",
  "temperature",
  "slope",
  "rivers",
  "flow",
  "lakes",
  "waterDistance",
  "shore",
  "vegetation",
  "macro",
] as const;

export type DebugLayer = (typeof DEBUG_LAYERS)[number];
