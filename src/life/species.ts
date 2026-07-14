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
// Capacity budget. The instance buffers are PACKED (see instancing.ts): `mesh.count`
// tracks the real live total, so the vertex load is proportional to the plants that
// actually grew — an ocean window costs near nothing, and `perChunkCap` is a WORST-CASE
// bound (every live chunk fills its cap), not a constant price. `49 × perChunkCap`
// only sizes the buffers (memory, ~0.5 MB per heavy species part).
//
// Worst case with these caps — 49 chunks of unbroken dense forest — is ~20-25 M
// triangles (~11-14 ms GPU on the desktop that ran the old 12.9 M registry at ~7 ms);
// typical mixed terrain sits far below. Desktop-only territory: a Quest-class VR
// target renders twice per frame and would want the tree caps cut to roughly a third.
//
// Density is bought twice over: caps up AND per-instance cost down — trunks ride the
// coarsest LOD and heavy crowns are card-decimated in the converter (`leafKeep`).
// Chunks are 256 m: a full Nadelwald chunk now holds ~290 conifers (one per ~15 m —
// a closed stand), a Laubwald chunk ~140 oaks + ~160 birches. Ground cover
// (flowers/mushrooms, 80-460 tris) is most of the instances but little of the
// weight; oak trunks (oak_01/oak_03 have no coarser LOD) dominate per instance —
// their caps stay the smallest lever.
//
// Source triangle counts (per instance, summed over parts — from convert-nature.ts):
//   oak-2 3192 · common-tree 2139 · rock-huge 1875 · palm 1772 · oak-3 1238
//   birch-2 1082 · pine-3 1039 · birch-3 1002 · berry-bush 891 · pine 870 · pine-2 767
//   birch 525 · bush 462 · dead-pine 447 · cactus 434 · mushroom-cluster 422
//   wheat 408 · rock 318 · reeds 280 · dead-tree 225 · branch-* 208 · rock-small 210
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

/** Species whose geometry is dead wood or mineral matter. Everything else in the
 * flora registry is living vegetation/fungi and participates in thermalTree. */
const THERMALLY_INERT_SPECIES: ReadonlySet<SpeciesId> = new Set([
  "dead-tree",
  "dead-pine",
  "stump",
  "stump-birch",
  "branch-pine",
  "branch-birch",
  "rock",
  "rock-small",
  "rock-huge",
  "moss-rock",
]);

export function isThermalFlora(def: SpeciesDef): boolean {
  return !THERMALLY_INERT_SPECIES.has(def.id);
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
    perChunkCap: 120,
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
    perChunkCap: 95,
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
    perChunkCap: 75,
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
    perChunkCap: 70,
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
    perChunkCap: 12,
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
    perChunkCap: 60,
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
    perChunkCap: 80,
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
    perChunkCap: 40,
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
    perChunkCap: 40,
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
    perChunkCap: 8,
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
    perChunkCap: 7,
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
    perChunkCap: 70,
    biomes: {
      [Biome.Forest]: 0.85,
      [Biome.Grassland]: 0.4,
      [Biome.Hills]: 0.4,
      [Biome.Taiga]: 0.5,
    },
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
    perChunkCap: 50,
    biomes: { [Biome.Forest]: 0.75, [Biome.Grassland]: 0.35, [Biome.Hills]: 0.35 },
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
    perChunkCap: 14,
    biomes: { [Biome.Forest]: 0.6, [Biome.Wetland]: 0.3, [Biome.Taiga]: 0.35 },
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
    perChunkCap: 36,
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
    perChunkCap: 60,
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
    perChunkCap: 50,
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
    perChunkCap: 24,
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
    perChunkCap: 45,
    biomes: { [Biome.Forest]: 0.7, [Biome.Taiga]: 0.6, [Biome.Wetland]: 0.2 },
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
    perChunkCap: 36,
    biomes: { [Biome.Forest]: 0.55, [Biome.Taiga]: 0.3 },
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
    perChunkCap: 28,
    biomes: { [Biome.Forest]: 0.45, [Biome.Wetland]: 0.25 },
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
    perChunkCap: 18,
    biomes: { [Biome.Forest]: 0.5, [Biome.Taiga]: 0.4 },
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
    perChunkCap: 14,
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
    perChunkCap: 14,
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
    perChunkCap: 36,
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
    perChunkCap: 36,
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
