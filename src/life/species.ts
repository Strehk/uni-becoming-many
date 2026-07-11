// ── Becoming Many — Species Registry ───────────────────────────
//
// One entry per kind of living thing. A species declares WHERE it grows (biome
// affinities × slope × moisture-by-proxy), HOW MANY may stand in one chunk, and HOW
// it moves. It does NOT declare its parts: those are discovered from the asset at
// load time, because the source meshes carry their own material split (a pine is
// "Wood" + "Green"; a birch is "White" + "Black" + "Green" + "DarkGreen"), and each
// distinct material becomes one instanced draw.
//
// PURE DATA — no three, no GPU. The scatter algorithm reads this; so does the
// asset loader (for `targetHeight`) and the material factory (for `sway`).
//
// Capacity budget. Cost is view-independent: the flora meshes never frustum-cull, and
// every instanced draw covers the species' FULL capacity (49 blocks — `mesh.count` is
// pinned, see instancing.ts). So the vertex load is a constant
// `49 × Σ(perChunkCap × tris)` ≈ 1.9 M triangles, and `perChunkCap` is the only lever
// on it. Empty and unused slots hold the all-zero matrix: they still run the vertex
// shader, but collapse to degenerate triangles that cost no fragment work.
//
// Source triangle counts (per instance, summed over parts):
//   common-tree 2888 · pine 1910 · palm 1772 · birch 1704 · berry-bush 891 · dead 820
//   cactus 434 · wheat/flower 408 · bush 363 · stump 232 · grass 192 · rock 70

import { Biome } from "../terrain/index.ts";

export type SpeciesId =
  | "pine"
  | "common-tree"
  | "birch"
  | "dead-tree"
  | "palm"
  | "rock"
  | "moss-rock"
  | "grass"
  | "grass-short"
  | "wheat"
  | "bush"
  | "berry-bush"
  | "flower"
  | "cactus"
  | "stump";

export interface SpeciesDef {
  readonly id: SpeciesId;
  /** Metres, base to tip. Normalizes the asset AND scales the sway bend mask. */
  readonly targetHeight: number;
  /** Max instances any single chunk may hold. See the capacity budget above. */
  readonly perChunkCap: number;
  /** Per-biome affinity 0..1, multiplied into the chunk's vegetation density.
   *  A biome absent from the map has affinity 0 — the species never grows there. */
  readonly biomes: Partial<Record<Biome, number>>;
  /** Reject candidates on ground steeper than this (slope 0..1). */
  readonly maxSlope: number;
  /** Uniform scale jitter, [min, max], applied about the base. */
  readonly scale: readonly [number, number];
  /** Per-instance albedo jitter, 0..1 — multiplies the asset's own material colour. */
  readonly tintJitter: number;
  /** Sway amplitude in metres at the crown, before `signals.unrest` scales it.
   *  0 for rocks and stumps: they are not wind-driven, and a swaying boulder reads
   *  as a bug rather than as life. */
  readonly sway: number;
}

/** The registry. Indexed with `SPECIES[id]` (never dot access — `noPropertyAccessFromIndexSignature`). */
export const SPECIES: Readonly<Record<SpeciesId, SpeciesDef>> = {
  // ── Trees ─────────────────────────────────────────────────────────────────
  pine: {
    id: "pine",
    targetHeight: 9,
    perChunkCap: 10,
    biomes: {
      [Biome.Taiga]: 1.0,
      [Biome.Forest]: 0.85,
      [Biome.Hills]: 0.4,
      [Biome.SnowMountain]: 0.12,
    },
    maxSlope: 0.55,
    scale: [0.75, 1.35],
    tintJitter: 0.14,
    sway: 0.35,
  },
  "common-tree": {
    id: "common-tree",
    targetHeight: 8,
    perChunkCap: 5,
    biomes: { [Biome.Forest]: 1.0, [Biome.Grassland]: 0.3, [Biome.Hills]: 0.45 },
    maxSlope: 0.5,
    scale: [0.8, 1.3],
    tintJitter: 0.16,
    sway: 0.4,
  },
  birch: {
    id: "birch",
    targetHeight: 7.5,
    perChunkCap: 4,
    biomes: { [Biome.Forest]: 0.55, [Biome.Taiga]: 0.5, [Biome.Tundra]: 0.2, [Biome.Hills]: 0.3 },
    maxSlope: 0.5,
    scale: [0.85, 1.2],
    tintJitter: 0.1,
    sway: 0.5,
  },
  "dead-tree": {
    id: "dead-tree",
    targetHeight: 6.5,
    perChunkCap: 3,
    biomes: {
      [Biome.Tundra]: 0.5,
      [Biome.Wetland]: 0.4,
      [Biome.RockyMountain]: 0.25,
      [Biome.Desert]: 0.12,
    },
    maxSlope: 0.6,
    scale: [0.7, 1.15],
    tintJitter: 0.08,
    sway: 0.18,
  },
  palm: {
    id: "palm",
    targetHeight: 8,
    perChunkCap: 2,
    biomes: { [Biome.Beach]: 0.9, [Biome.Desert]: 0.2 },
    maxSlope: 0.35,
    scale: [0.85, 1.25],
    tintJitter: 0.1,
    sway: 0.6,
  },

  // ── Rock (never sways) ────────────────────────────────────────────────────
  rock: {
    id: "rock",
    targetHeight: 1.2,
    perChunkCap: 18,
    biomes: {
      [Biome.RockyMountain]: 1.0,
      [Biome.SnowMountain]: 0.6,
      [Biome.Hills]: 0.45,
      [Biome.Tundra]: 0.35,
      [Biome.Beach]: 0.2,
      [Biome.Grassland]: 0.1,
    },
    maxSlope: 0.95,
    scale: [0.6, 1.9],
    tintJitter: 0.12,
    sway: 0,
  },
  "moss-rock": {
    id: "moss-rock",
    targetHeight: 1.0,
    perChunkCap: 12,
    biomes: {
      [Biome.Forest]: 0.7,
      [Biome.Wetland]: 0.55,
      [Biome.Taiga]: 0.45,
      [Biome.Hills]: 0.25,
    },
    maxSlope: 0.9,
    scale: [0.6, 1.7],
    tintJitter: 0.12,
    sway: 0,
  },

  // ── Ground cover ──────────────────────────────────────────────────────────
  grass: {
    id: "grass",
    targetHeight: 0.5,
    perChunkCap: 80,
    biomes: { [Biome.Grassland]: 1.0, [Biome.Hills]: 0.5, [Biome.Forest]: 0.3, [Biome.Taiga]: 0.2 },
    maxSlope: 0.7,
    scale: [0.7, 1.5],
    tintJitter: 0.2,
    sway: 0.09,
  },
  "grass-short": {
    id: "grass-short",
    targetHeight: 0.32,
    perChunkCap: 60,
    biomes: {
      [Biome.Grassland]: 0.8,
      [Biome.Tundra]: 0.5,
      [Biome.Hills]: 0.4,
      [Biome.Beach]: 0.15,
    },
    maxSlope: 0.75,
    scale: [0.7, 1.4],
    tintJitter: 0.2,
    sway: 0.07,
  },
  wheat: {
    id: "wheat",
    targetHeight: 0.9,
    perChunkCap: 8,
    biomes: { [Biome.Grassland]: 0.5, [Biome.Wetland]: 0.3 },
    maxSlope: 0.3,
    scale: [0.8, 1.2],
    tintJitter: 0.15,
    sway: 0.14,
  },
  bush: {
    id: "bush",
    targetHeight: 1.4,
    perChunkCap: 14,
    biomes: { [Biome.Forest]: 0.6, [Biome.Grassland]: 0.4, [Biome.Hills]: 0.4, [Biome.Taiga]: 0.3 },
    maxSlope: 0.6,
    scale: [0.7, 1.4],
    tintJitter: 0.16,
    sway: 0.1,
  },
  "berry-bush": {
    id: "berry-bush",
    targetHeight: 1.3,
    perChunkCap: 3,
    biomes: { [Biome.Forest]: 0.5, [Biome.Wetland]: 0.3, [Biome.Taiga]: 0.3 },
    maxSlope: 0.55,
    scale: [0.8, 1.25],
    tintJitter: 0.12,
    sway: 0.1,
  },
  flower: {
    id: "flower",
    targetHeight: 0.35,
    perChunkCap: 20,
    biomes: { [Biome.Grassland]: 0.7, [Biome.Hills]: 0.3, [Biome.Wetland]: 0.2 },
    maxSlope: 0.5,
    scale: [0.8, 1.3],
    tintJitter: 0.25,
    sway: 0.06,
  },
  cactus: {
    id: "cactus",
    targetHeight: 1.8,
    perChunkCap: 6,
    biomes: { [Biome.Desert]: 1.0 },
    maxSlope: 0.4,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0.04,
  },
  stump: {
    id: "stump",
    targetHeight: 0.6,
    perChunkCap: 3,
    biomes: { [Biome.Forest]: 0.4, [Biome.Taiga]: 0.3, [Biome.Wetland]: 0.2 },
    maxSlope: 0.6,
    scale: [0.8, 1.4],
    tintJitter: 0.1,
    sway: 0,
  },
};

/** Stable iteration order — also the per-species PRNG salt, so adding a species
 *  never reshuffles the placement of the ones before it. */
export const SPECIES_IDS: readonly SpeciesId[] = [
  "pine",
  "common-tree",
  "birch",
  "dead-tree",
  "palm",
  "rock",
  "moss-rock",
  "grass",
  "grass-short",
  "wheat",
  "bush",
  "berry-bush",
  "flower",
  "cactus",
  "stump",
];
