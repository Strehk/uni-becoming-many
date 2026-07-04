// ── Becoming Many — Pass B Landform Tile Set ───────────────────
//
// Within the biome planned by Pass A, a SECOND WFC pass lays out landform
// archetypes over a finer "meso" grid. Each tile carries an elevation band (the
// height it wants, normalised 0..1, same scale as the field height), a family
// (which biomes favour it), a noise profile, and a base weight.
//
// The families let the per-cell priors be conditioned on the Pass A biome, so a
// mountain macro cell fills with peak/ridge/cliff tiles, a desert cell with dune
// tiles, etc. Adjacency (heightConstraints.ts) then makes them chain into coherent
// landforms — ridges connect, peaks stay isolated, dunes order windward→crest→lee.
//
// ≤ 32 tiles (one bitmask domain). PURE CPU — no three, no DOM.

export enum Landform {
  Deep = 0,
  Shelf = 1,
  Shore = 2,
  Berm = 3,
  Flat = 4,
  GentleRise = 5,
  GentleDip = 6,
  Hollow = 7,
  Slope = 8,
  Crest = 9,
  ValleyFloor = 10,
  UpperSlope = 11,
  Ridge = 12,
  Saddle = 13,
  Peak = 14,
  Cliff = 15,
  Interdune = 16,
  DuneWindward = 17,
  DuneCrest = 18,
  DuneLee = 19,
}

export const LANDFORM_COUNT = 20;

export type LandformFamily = "water" | "coast" | "lowland" | "hill" | "mountain" | "desert";

export interface LandformTile {
  id: Landform;
  name: string;
  family: LandformFamily;
  /** [lo, hi] target elevation in normalised 0..1 height. */
  elevationBand: [number, number];
  noiseProfile: "flat" | "rolling" | "dunes" | "ridged" | "fbm";
  weight: number;
}

export const LANDFORMS: LandformTile[] = [
  {
    id: Landform.Deep,
    name: "deep",
    family: "water",
    elevationBand: [0.0, 0.3],
    noiseProfile: "flat",
    weight: 1.0,
  },
  {
    id: Landform.Shelf,
    name: "shelf",
    family: "water",
    elevationBand: [0.3, 0.4],
    noiseProfile: "flat",
    weight: 1.0,
  },
  {
    id: Landform.Shore,
    name: "shore",
    family: "coast",
    elevationBand: [0.4, 0.46],
    noiseProfile: "flat",
    weight: 1.0,
  },
  {
    id: Landform.Berm,
    name: "berm",
    family: "coast",
    elevationBand: [0.45, 0.5],
    noiseProfile: "rolling",
    weight: 0.8,
  },
  {
    id: Landform.Flat,
    name: "flat",
    family: "lowland",
    elevationBand: [0.46, 0.53],
    noiseProfile: "flat",
    weight: 1.3,
  },
  {
    id: Landform.GentleRise,
    name: "gentleRise",
    family: "lowland",
    elevationBand: [0.52, 0.6],
    noiseProfile: "rolling",
    weight: 0.7,
  },
  {
    id: Landform.GentleDip,
    name: "gentleDip",
    family: "lowland",
    elevationBand: [0.44, 0.5],
    noiseProfile: "rolling",
    weight: 0.5,
  },
  {
    id: Landform.Hollow,
    name: "hollow",
    family: "hill",
    elevationBand: [0.52, 0.6],
    noiseProfile: "rolling",
    weight: 0.6,
  },
  {
    id: Landform.Slope,
    name: "slope",
    family: "hill",
    elevationBand: [0.58, 0.7],
    noiseProfile: "rolling",
    weight: 1.1,
  },
  {
    id: Landform.Crest,
    name: "crest",
    family: "hill",
    elevationBand: [0.68, 0.78],
    noiseProfile: "rolling",
    weight: 0.7,
  },
  {
    id: Landform.ValleyFloor,
    name: "valleyFloor",
    family: "mountain",
    elevationBand: [0.55, 0.66],
    noiseProfile: "fbm",
    weight: 0.6,
  },
  {
    id: Landform.UpperSlope,
    name: "upperSlope",
    family: "mountain",
    elevationBand: [0.68, 0.8],
    noiseProfile: "ridged",
    weight: 1.0,
  },
  {
    id: Landform.Ridge,
    name: "ridge",
    family: "mountain",
    elevationBand: [0.8, 0.9],
    noiseProfile: "ridged",
    weight: 1.0,
  },
  {
    id: Landform.Saddle,
    name: "saddle",
    family: "mountain",
    elevationBand: [0.74, 0.84],
    noiseProfile: "ridged",
    weight: 0.6,
  },
  {
    id: Landform.Peak,
    name: "peak",
    family: "mountain",
    elevationBand: [0.9, 1.0],
    noiseProfile: "ridged",
    weight: 0.7,
  },
  {
    id: Landform.Cliff,
    name: "cliff",
    family: "mountain",
    elevationBand: [0.7, 0.88],
    noiseProfile: "ridged",
    weight: 0.5,
  },
  {
    id: Landform.Interdune,
    name: "interdune",
    family: "desert",
    elevationBand: [0.47, 0.53],
    noiseProfile: "flat",
    weight: 0.8,
  },
  {
    id: Landform.DuneWindward,
    name: "duneWindward",
    family: "desert",
    elevationBand: [0.5, 0.58],
    noiseProfile: "dunes",
    weight: 1.0,
  },
  {
    id: Landform.DuneCrest,
    name: "duneCrest",
    family: "desert",
    elevationBand: [0.56, 0.64],
    noiseProfile: "dunes",
    weight: 0.9,
  },
  {
    id: Landform.DuneLee,
    name: "duneLee",
    family: "desert",
    elevationBand: [0.5, 0.58],
    noiseProfile: "dunes",
    weight: 1.0,
  },
];

/** Tiles indexed by Landform id (LANDFORMS is already in enum order; be safe). */
export const LANDFORM_BY_ID: LandformTile[] = (() => {
  const arr: LandformTile[] = [];
  for (const t of LANDFORMS) arr[t.id] = t;
  return arr;
})();

/** Elevation-band midpoint per landform id (the target surface height). */
export const LANDFORM_ELEVATION: number[] = LANDFORM_BY_ID.map((t) =>
  t ? (t.elevationBand[0] + t.elevationBand[1]) * 0.5 : 0.5,
);
