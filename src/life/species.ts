// ── Becoming Many — Species Registry ───────────────────────────
//
// One entry per kind of living thing. A species declares WHERE it grows (biome
// affinities × slope × moisture-by-proxy × an optional `placement` field over world
// XZ — see woodland.ts), HOW MANY may stand in one chunk, HOW it moves, and what it
// is to the SENSES (surface temperature, UV reflectance, scent). It does NOT declare
// its parts: those are discovered from the asset at load time, because the source
// meshes carry their own material split (a pine is bark + needles; a birch is
// white + black + foliage), and each distinct material becomes one instanced draw.
//
// PURE DATA — no three, no GPU. The scatter algorithm reads this; so does the
// asset loader (for `targetHeight`), the material factory (for `sway` + `senses`),
// and the duft coupling (for `senses.scent`).
//
// Capacity budget. Cost is view-independent — the flora meshes never frustum-cull, and
// every instanced draw covers the species' FULL capacity (49 blocks — `mesh.count` is
// pinned, see instancing.ts). So the vertex load is a CONSTANT `49 × Σ(perChunkCap × tris)`
// ≈ 17.5 M triangles across ~44 k live instances, forest or ocean alike, and
// `perChunkCap` is the only lever on it. Slots no plant claimed hold the all-zero matrix:
// they run the vertex shader but collapse to degenerate triangles with no fragment cost.
//
// Measured on desktop WebGPU (previous 12.9 M-tri registry): GPU frame ~7 ms — the
// nature-kit registry adds ~35% vertex load on that baseline. VR renders twice per
// frame, so a Quest-class target would still want these roughly halved.
//
// A species you raise the cap on costs its full price in EVERY chunk, including biomes
// its rules never let it grow in — so spend where fullness reads cheapest. Ground cover
// (flowers/mushrooms, 80-420 tris) is most of the instances but little of the triangle
// weight; trees (750-4400 tris) dominate — their caps are split across the variant
// trio of each type, so a Tannenwald stays as dense as the old single-pine forest.
//
// Source triangle counts (per instance, summed over parts — from convert-nature.ts):
//   oak-2 4359 · common-tree 2943 · rock-huge 1875 · palm 1772 · birch-2 1654
//   birch-3 1492 · pine-3 1440 · oak-3 1420 · pine 1131 · pine-2 1037 · dead-pine 897
//   berry-bush 891 · birch 753 · bush 462 · dead-tree 453 · mushroom-cluster 422
//   cactus 434 · wheat 408 · rock 318 · reeds 280 · branch-* 208 · rock-small 210
//   stump-birch 126 · shrub 120 · mushroom-* ~105 · stump 90 · flower-* 80 · moss-rock 70

import { Biome } from "../terrain/index.ts";
import { laubWeight, lichtung, nadelWeight } from "./woodland.ts";

export type SpeciesId =
  | "pine"
  | "common-tree"
  | "birch"
  | "dead-tree"
  | "palm"
  | "rock"
  | "moss-rock"
  | "wheat"
  | "bush"
  | "berry-bush"
  | "flower"
  | "cactus"
  | "stump"
  // ── Nature-kit additions (appended — SPECIES_IDS order is the PRNG salt) ──
  | "pine-2"
  | "pine-3"
  | "oak-2"
  | "oak-3"
  | "birch-2"
  | "birch-3"
  | "dead-pine"
  | "bush-2"
  | "flower-2"
  | "shrub"
  | "reeds"
  | "mushroom-brown"
  | "mushroom-red"
  | "mushroom-white"
  | "mushroom-cluster"
  | "stump-birch"
  | "branch-pine"
  | "branch-birch"
  | "rock-small"
  | "rock-huge";

/** Scent vocabulary key — matches `SCENT_TYPES[].key` in src/senses/duft/params.ts.
 *  A string key (not an index) so life never imports the senses module; the duft
 *  coupling resolves keys to indices at wiring time. */
export type ScentKey = "blume" | "lavendel" | "baum" | "kiefer" | "kraut" | "pilz";

/** What this species is to the senses. Every field optional — absent means the
 *  flora-wide default (the values material.ts always used). */
export interface SpeciesSenseProps {
  /** Baseline surface temperature in Kelvin (Infrarot). Default 296 — "alive,
   *  a touch warmer than the ground". Dead wood sits at ambient (~293). */
  readonly tempK?: number;
  /** How much the sun-facing side warms up, Kelvin. Default 8. Stone soaks more. */
  readonly tempFacingK?: number;
  /** Flat UV reflectance 0..1 (UV sense). Default 0.35. Warning patterns (fly
   *  agaric) and nectar guides (flowers) run brighter. */
  readonly uvSignal?: number;
  /** Scent this species feeds into the duft field, with its plume radius (m) and
   *  emission height above the instance base (m). */
  readonly scent?: {
    readonly type: ScentKey;
    readonly radius: number;
    readonly heightOffset: number;
  };
}

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
  /** Optional pure world-XZ probability modulator (0..∞, 1 = neutral), multiplied
   *  into the scatter roll. This is how the woodland structure (Nadel/Laub/Misch
   *  zones, Lichtungen — see woodland.ts) shapes forests without new biomes.
   *  MUST be pure and deterministic; it runs inside the chunk scatter. */
  readonly placement?: (x: number, z: number, biome: Biome) => number;
  /** Sensory profile — consumed by material.ts (tempK/uvSignal) and the duft
   *  coupling (scent). Absent fields fall back to the flora-wide defaults. */
  readonly senses?: SpeciesSenseProps;
}

// ── Woodland placement helpers (shared shapes, one closure per species) ──────

/** Conifers: full strength in Nadelwald zones of Forest, thinned on clearings.
 *  Taiga and everything else is untouched — there the biome affinity rules alone. */
const conifer = (x: number, z: number, biome: Biome): number =>
  biome === Biome.Forest ? nadelWeight(x, z) * (1 - lichtung(x, z)) : 1;

/** Broadleaves: the complement — Laubwald zones of Forest, thinned on clearings. */
const broadleaf = (x: number, z: number, biome: Biome): number =>
  biome === Biome.Forest ? laubWeight(x, z) * (1 - lichtung(x, z)) : 1;

/** Birches ride the deciduous side but bleed into mixed stands (+0.25 floor). */
const birchStand = (x: number, z: number, biome: Biome): number =>
  biome === Biome.Forest ? Math.min(1, laubWeight(x, z) + 0.25) * (1 - lichtung(x, z)) : 1;

/** Understorey that blooms where the canopy opens: ×(1 + lichtung·gain). */
const clearingLover =
  (gain: number) =>
  (x: number, z: number): number =>
    1 + lichtung(x, z) * gain;

/** Forest-floor life that hides from open sky, leaning to one woodland type. */
const forestFloor =
  (lean: "nadel" | "laub" | "none") =>
  (x: number, z: number, biome: Biome): number => {
    const shade = 1 - lichtung(x, z) * 0.8;
    if (biome !== Biome.Forest || lean === "none") return shade;
    const w = lean === "nadel" ? nadelWeight(x, z) : laubWeight(x, z);
    return shade * (0.4 + 0.6 * w);
  };

/** The registry. Indexed with `SPECIES[id]` (never dot access — `noPropertyAccessFromIndexSignature`). */
export const SPECIES: Readonly<Record<SpeciesId, SpeciesDef>> = {
  // ── Conifers (Tannen-/Nadelwald) ──────────────────────────────────────────
  pine: {
    id: "pine",
    targetHeight: 9,
    perChunkCap: 36,
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
    placement: conifer,
    senses: { scent: { type: "kiefer", radius: 2.8, heightOffset: 3 } },
  },
  "pine-2": {
    id: "pine-2",
    targetHeight: 8.5,
    perChunkCap: 28,
    biomes: {
      [Biome.Taiga]: 1.0,
      [Biome.Forest]: 0.85,
      [Biome.Hills]: 0.35,
      [Biome.SnowMountain]: 0.12,
    },
    maxSlope: 0.55,
    scale: [0.75, 1.35],
    tintJitter: 0.14,
    sway: 0.35,
    placement: conifer,
    senses: { scent: { type: "kiefer", radius: 2.8, heightOffset: 3 } },
  },
  "pine-3": {
    id: "pine-3",
    targetHeight: 10,
    perChunkCap: 26,
    biomes: { [Biome.Taiga]: 0.9, [Biome.Forest]: 0.8, [Biome.Hills]: 0.35 },
    maxSlope: 0.55,
    scale: [0.75, 1.3],
    tintJitter: 0.14,
    sway: 0.32,
    placement: conifer,
    senses: { scent: { type: "kiefer", radius: 2.8, heightOffset: 3.4 } },
  },

  // ── Broadleaves (Laubwald) — oaks under the legacy "common-tree" id ───────
  "common-tree": {
    id: "common-tree",
    targetHeight: 8,
    perChunkCap: 18,
    biomes: { [Biome.Forest]: 1.0, [Biome.Grassland]: 0.3, [Biome.Hills]: 0.45 },
    maxSlope: 0.5,
    scale: [0.8, 1.3],
    tintJitter: 0.16,
    sway: 0.4,
    placement: broadleaf,
    senses: { scent: { type: "baum", radius: 3, heightOffset: 3.2 } },
  },
  "oak-2": {
    id: "oak-2",
    targetHeight: 9,
    perChunkCap: 6,
    biomes: { [Biome.Forest]: 0.9, [Biome.Grassland]: 0.2 },
    maxSlope: 0.5,
    scale: [0.85, 1.3],
    tintJitter: 0.16,
    sway: 0.38,
    placement: broadleaf,
    senses: { scent: { type: "baum", radius: 3.4, heightOffset: 3.6 } },
  },
  "oak-3": {
    id: "oak-3",
    targetHeight: 7.5,
    perChunkCap: 18,
    biomes: { [Biome.Forest]: 1.0, [Biome.Grassland]: 0.25, [Biome.Hills]: 0.4 },
    maxSlope: 0.5,
    scale: [0.8, 1.25],
    tintJitter: 0.16,
    sway: 0.4,
    placement: broadleaf,
    senses: { scent: { type: "baum", radius: 3, heightOffset: 3 } },
  },
  birch: {
    id: "birch",
    targetHeight: 7.5,
    perChunkCap: 16,
    biomes: { [Biome.Forest]: 0.55, [Biome.Taiga]: 0.5, [Biome.Tundra]: 0.2, [Biome.Hills]: 0.3 },
    maxSlope: 0.5,
    scale: [0.85, 1.2],
    tintJitter: 0.1,
    sway: 0.5,
    placement: birchStand,
  },
  "birch-2": {
    id: "birch-2",
    targetHeight: 8,
    perChunkCap: 12,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.45, [Biome.Hills]: 0.3 },
    maxSlope: 0.5,
    scale: [0.85, 1.2],
    tintJitter: 0.1,
    sway: 0.48,
    placement: birchStand,
  },
  "birch-3": {
    id: "birch-3",
    targetHeight: 7,
    perChunkCap: 12,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.45, [Biome.Tundra]: 0.2 },
    maxSlope: 0.5,
    scale: [0.85, 1.2],
    tintJitter: 0.1,
    sway: 0.5,
    placement: birchStand,
  },

  // ── Dead wood — ambient temperature, no metabolic warmth ──────────────────
  "dead-tree": {
    id: "dead-tree",
    targetHeight: 6.5,
    perChunkCap: 5,
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
    senses: { tempK: 293 },
  },
  "dead-pine": {
    id: "dead-pine",
    targetHeight: 7,
    perChunkCap: 3,
    biomes: { [Biome.Taiga]: 0.25, [Biome.Forest]: 0.15, [Biome.Tundra]: 0.2 },
    maxSlope: 0.6,
    scale: [0.7, 1.15],
    tintJitter: 0.08,
    sway: 0.15,
    placement: conifer,
    senses: { tempK: 293 },
  },
  palm: {
    id: "palm",
    targetHeight: 8,
    perChunkCap: 4,
    biomes: { [Biome.Beach]: 0.9, [Biome.Desert]: 0.2 },
    maxSlope: 0.35,
    scale: [0.85, 1.25],
    tintJitter: 0.1,
    sway: 0.6,
  },

  // ── Rocks (never sway) — three size tiers + the mossy forest boulder ─────
  rock: {
    id: "rock",
    targetHeight: 1.9,
    perChunkCap: 20,
    biomes: {
      [Biome.RockyMountain]: 1.0,
      [Biome.SnowMountain]: 0.6,
      [Biome.Hills]: 0.45,
      [Biome.Tundra]: 0.35,
      [Biome.Beach]: 0.2,
      [Biome.Grassland]: 0.1,
      [Biome.Forest]: 0.15,
    },
    maxSlope: 0.95,
    scale: [0.45, 3.2],
    tintJitter: 0.12,
    sway: 0,
    senses: { tempK: 291, tempFacingK: 14 },
  },
  "rock-small": {
    id: "rock-small",
    targetHeight: 0.7,
    perChunkCap: 24,
    biomes: {
      [Biome.Hills]: 0.5,
      [Biome.Forest]: 0.3,
      [Biome.Taiga]: 0.3,
      [Biome.RockyMountain]: 0.6,
      [Biome.SnowMountain]: 0.4,
      [Biome.Grassland]: 0.15,
      [Biome.Tundra]: 0.3,
    },
    maxSlope: 0.95,
    scale: [0.5, 2.2],
    tintJitter: 0.12,
    sway: 0,
    senses: { tempK: 291, tempFacingK: 14 },
  },
  "rock-huge": {
    id: "rock-huge",
    targetHeight: 4.5,
    perChunkCap: 3,
    biomes: { [Biome.RockyMountain]: 0.8, [Biome.Hills]: 0.25, [Biome.SnowMountain]: 0.3 },
    maxSlope: 0.95,
    scale: [0.6, 2.4],
    tintJitter: 0.12,
    sway: 0,
    senses: { tempK: 291, tempFacingK: 14 },
  },
  "moss-rock": {
    id: "moss-rock",
    targetHeight: 1.6,
    perChunkCap: 22,
    biomes: {
      [Biome.Forest]: 0.7,
      [Biome.Wetland]: 0.55,
      [Biome.Taiga]: 0.45,
      [Biome.Hills]: 0.25,
    },
    maxSlope: 0.9,
    scale: [0.45, 2.8],
    tintJitter: 0.12,
    sway: 0,
    senses: { tempK: 292, tempFacingK: 10 },
  },

  // ── Understorey & ground cover ────────────────────────────────────────────
  // Grass/grass-short were removed: the GPU grass (src/grass/) replaces them, with the
  // biome affinities carried on in src/grass/biomes.ts.
  wheat: {
    id: "wheat",
    targetHeight: 0.9,
    perChunkCap: 22,
    biomes: { [Biome.Grassland]: 0.5, [Biome.Wetland]: 0.3 },
    maxSlope: 0.3,
    scale: [0.8, 1.2],
    tintJitter: 0.15,
    sway: 0.14,
  },
  bush: {
    id: "bush",
    targetHeight: 1.4,
    perChunkCap: 20,
    biomes: { [Biome.Forest]: 0.6, [Biome.Grassland]: 0.4, [Biome.Hills]: 0.4, [Biome.Taiga]: 0.3 },
    maxSlope: 0.6,
    scale: [0.7, 1.4],
    tintJitter: 0.16,
    sway: 0.1,
    placement: clearingLover(1.5),
    senses: { scent: { type: "kraut", radius: 1.6, heightOffset: 0.7 } },
  },
  "bush-2": {
    id: "bush-2",
    targetHeight: 1.2,
    perChunkCap: 14,
    biomes: { [Biome.Forest]: 0.5, [Biome.Grassland]: 0.35, [Biome.Hills]: 0.35 },
    maxSlope: 0.6,
    scale: [0.7, 1.4],
    tintJitter: 0.16,
    sway: 0.1,
    placement: clearingLover(1.5),
    senses: { scent: { type: "kraut", radius: 1.6, heightOffset: 0.6 } },
  },
  "berry-bush": {
    id: "berry-bush",
    targetHeight: 1.3,
    perChunkCap: 7,
    biomes: { [Biome.Forest]: 0.5, [Biome.Wetland]: 0.3, [Biome.Taiga]: 0.3 },
    maxSlope: 0.55,
    scale: [0.8, 1.25],
    tintJitter: 0.12,
    sway: 0.1,
    placement: clearingLover(1.2),
    senses: { scent: { type: "kraut", radius: 1.5, heightOffset: 0.6 } },
  },
  shrub: {
    id: "shrub",
    targetHeight: 1.0,
    perChunkCap: 18,
    biomes: { [Biome.Grassland]: 0.5, [Biome.Forest]: 0.2, [Biome.Hills]: 0.35 },
    maxSlope: 0.6,
    scale: [0.7, 1.4],
    tintJitter: 0.16,
    sway: 0.1,
    placement: clearingLover(3),
    senses: { scent: { type: "kraut", radius: 1.4, heightOffset: 0.5 } },
  },
  flower: {
    id: "flower",
    targetHeight: 0.35,
    perChunkCap: 48,
    biomes: {
      [Biome.Grassland]: 0.8,
      [Biome.Hills]: 0.3,
      [Biome.Wetland]: 0.2,
      [Biome.Forest]: 0.15,
    },
    maxSlope: 0.5,
    scale: [0.8, 1.3],
    tintJitter: 0.25,
    sway: 0.06,
    placement: clearingLover(4),
    senses: { uvSignal: 0.7, scent: { type: "blume", radius: 1.8, heightOffset: 0.3 } },
  },
  "flower-2": {
    id: "flower-2",
    targetHeight: 0.4,
    perChunkCap: 40,
    biomes: { [Biome.Grassland]: 0.7, [Biome.Hills]: 0.3, [Biome.Forest]: 0.12 },
    maxSlope: 0.5,
    scale: [0.8, 1.3],
    tintJitter: 0.25,
    sway: 0.06,
    placement: clearingLover(4),
    senses: { uvSignal: 0.7, scent: { type: "blume", radius: 1.8, heightOffset: 0.3 } },
  },
  reeds: {
    id: "reeds",
    targetHeight: 1.6,
    perChunkCap: 20,
    biomes: { [Biome.Wetland]: 0.9, [Biome.Beach]: 0.15, [Biome.Lake]: 0.2 },
    maxSlope: 0.35,
    scale: [0.8, 1.3],
    tintJitter: 0.14,
    sway: 0.2,
  },
  cactus: {
    id: "cactus",
    targetHeight: 1.8,
    perChunkCap: 14,
    biomes: { [Biome.Desert]: 1.0 },
    maxSlope: 0.4,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0.04,
  },

  // ── Mushrooms — decomposition heat, warning UV on the fly agaric ──────────
  "mushroom-brown": {
    id: "mushroom-brown",
    targetHeight: 0.25,
    perChunkCap: 10,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.45, [Biome.Wetland]: 0.2 },
    maxSlope: 0.55,
    scale: [0.7, 1.5],
    tintJitter: 0.15,
    sway: 0,
    placement: forestFloor("nadel"),
    senses: { tempK: 297, scent: { type: "pilz", radius: 1.2, heightOffset: 0.15 } },
  },
  "mushroom-red": {
    id: "mushroom-red",
    targetHeight: 0.28,
    perChunkCap: 8,
    biomes: { [Biome.Forest]: 0.4, [Biome.Taiga]: 0.25 },
    maxSlope: 0.55,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("laub"),
    senses: {
      tempK: 297,
      uvSignal: 0.85,
      scent: { type: "pilz", radius: 1.2, heightOffset: 0.15 },
    },
  },
  "mushroom-white": {
    id: "mushroom-white",
    targetHeight: 0.22,
    perChunkCap: 6,
    biomes: { [Biome.Forest]: 0.3, [Biome.Wetland]: 0.25 },
    maxSlope: 0.55,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("none"),
    senses: { tempK: 297, uvSignal: 0.6, scent: { type: "pilz", radius: 1.2, heightOffset: 0.12 } },
  },
  "mushroom-cluster": {
    id: "mushroom-cluster",
    targetHeight: 0.3,
    perChunkCap: 4,
    biomes: { [Biome.Forest]: 0.35, [Biome.Taiga]: 0.3 },
    maxSlope: 0.55,
    scale: [0.8, 1.4],
    tintJitter: 0.12,
    sway: 0,
    placement: forestFloor("none"),
    senses: { tempK: 297, scent: { type: "pilz", radius: 1.5, heightOffset: 0.15 } },
  },

  // ── Forest-floor props — stumps and fallen branches, typed to their wood ──
  stump: {
    id: "stump",
    targetHeight: 0.6,
    perChunkCap: 4,
    biomes: { [Biome.Forest]: 0.4, [Biome.Taiga]: 0.3, [Biome.Wetland]: 0.2 },
    maxSlope: 0.6,
    scale: [0.8, 1.4],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("nadel"),
    senses: { tempK: 294 },
  },
  "stump-birch": {
    id: "stump-birch",
    targetHeight: 0.6,
    perChunkCap: 4,
    biomes: { [Biome.Forest]: 0.4, [Biome.Taiga]: 0.2 },
    maxSlope: 0.6,
    scale: [0.8, 1.4],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("laub"),
    senses: { tempK: 294 },
  },
  "branch-pine": {
    id: "branch-pine",
    targetHeight: 0.35,
    perChunkCap: 12,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.4 },
    maxSlope: 0.7,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("nadel"),
    senses: { tempK: 293 },
  },
  "branch-birch": {
    id: "branch-birch",
    targetHeight: 0.35,
    perChunkCap: 12,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.3 },
    maxSlope: 0.7,
    scale: [0.7, 1.5],
    tintJitter: 0.1,
    sway: 0,
    placement: forestFloor("laub"),
    senses: { tempK: 293 },
  },
};

/** Stable iteration order — also the per-species PRNG salt, so adding a species
 *  never reshuffles the placement of the ones before it. New nature-kit species
 *  are APPENDED; the original thirteen keep their salts. */
export const SPECIES_IDS: readonly SpeciesId[] = [
  "pine",
  "common-tree",
  "birch",
  "dead-tree",
  "palm",
  "rock",
  "moss-rock",
  "wheat",
  "bush",
  "berry-bush",
  "flower",
  "cactus",
  "stump",
  "pine-2",
  "pine-3",
  "oak-2",
  "oak-3",
  "birch-2",
  "birch-3",
  "dead-pine",
  "bush-2",
  "flower-2",
  "shrub",
  "reeds",
  "mushroom-brown",
  "mushroom-red",
  "mushroom-white",
  "mushroom-cluster",
  "stump-birch",
  "branch-pine",
  "branch-birch",
  "rock-small",
  "rock-huge",
];
