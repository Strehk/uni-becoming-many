// ── Becoming Many — Flora & Fauna config ───────────────────────
//
// The single source of truth for the tunable knobs that shape the living world:
// how dense the forests grow, how many mushrooms spawn, how the bird flocks roam.
// PURE DATA — no three, no DOM. Consumed by src/life (flora), src/creatures
// (fauna), the dev panel (src/dev-console/flora-fauna-controls.ts) and the state
// round-trip (state.ts).
//
// Flora density is expressed as MULTIPLIERS over each species' base `perChunkCap`
// (species.ts), grouped into five categories plus a global scalar — far more
// legible than 33 raw caps. `effectiveCap(id, cfg)` folds global × category (or a
// per-species override) onto the base cap. The multipliers are bounded by
// MAX_DENSITY so the flora instance buffers can be pre-sized once (see life:
// buffers hold `MAX_LIVE_CHUNKS × baseCap × MAX_DENSITY`, so density changes in
// [0, MAX_DENSITY] never reallocate — they just re-scatter).

import { SPECIES, type SpeciesId } from "../life/species.ts";

/** Hard ceiling on any density multiplier — also the flora buffer head-room
 *  factor. Raising it costs VRAM (buffers scale with it), notably on Quest VR.
 *  3 gives typed-in values real headroom past the slider ranges. */
export const MAX_DENSITY = 3;

export type FloraCategory = "tree" | "undergrowth" | "flower" | "mushroom" | "rock" | "deadwood";

/** Which species each category scales. Every SpeciesId appears exactly once. */
export const CATEGORY_SPECIES: Readonly<Record<FloraCategory, readonly SpeciesId[]>> = {
  tree: [
    "pine",
    "pine-2",
    "pine-3",
    "common-tree",
    "oak-2",
    "oak-3",
    "birch",
    "birch-2",
    "birch-3",
    "dead-tree",
    "dead-pine",
    "palm",
  ],
  undergrowth: ["bush", "bush-2", "bush-3", "berry-bush", "shrub", "cactus"],
  flower: [
    "flower",
    "flower-2",
    "flower-3",
    "flower-4",
    "flower-5",
    "flower-6",
    "flower-7",
    "wheat",
    "reeds",
  ],
  mushroom: ["mushroom-brown", "mushroom-red", "mushroom-white", "mushroom-cluster"],
  rock: ["rock", "rock-small", "rock-huge", "moss-rock"],
  // The forest floor: fallen branches and cut stumps ("Zeug auf dem Boden").
  deadwood: ["stump", "stump-birch", "branch-pine", "branch-birch"],
};

/** Reverse lookup: species → its category. */
export const SPECIES_CATEGORY: Readonly<Record<SpeciesId, FloraCategory>> = (() => {
  const out = {} as Record<SpeciesId, FloraCategory>;
  for (const [category, ids] of Object.entries(CATEGORY_SPECIES) as [
    FloraCategory,
    readonly SpeciesId[],
  ][]) {
    for (const id of ids) out[id] = category;
  }
  return out;
})();

export interface FloraConfig {
  /** Global density multiplier over every species' base cap (1 = neutral). */
  readonly globalDensity: number;
  /** Per-category multipliers, composed with `globalDensity`. */
  readonly treeDensity: number;
  readonly undergrowthDensity: number;
  readonly flowerDensity: number;
  readonly mushroomDensity: number;
  readonly rockDensity: number;
  /** Forest-floor litter (stumps + fallen branches), separate from rocks. */
  readonly deadwoodDensity: number;

  // ── Wald-Zusammensetzung ──
  /** Conifer share of the Forest biome, 0..1 — 0 = pure Laubwald, 1 = pure
   *  Tannenwald; 0.5 is the hand-tuned balance. */
  readonly nadelAnteil: number;
  /** Width of the Mischwald transition band, 0..0.6 (0.3 = original). Wider =
   *  more mixed forest; 0 = hard conifer/deciduous borders. */
  readonly mischBreite: number;
  /** Clearing amount 0..1 — higher = more/larger Lichtungen (opener forest);
   *  0.5 is neutral (the hand-tuned original). */
  readonly forestClearing: number;
  /** Scales the conifer↔deciduous zone size (× on the woodland type wavelength). */
  readonly forestZoneScale: number;

  // ── Bäume ──
  /** Multiplier on every tree's MEAN size, 1 = authored. */
  readonly treeScale: number;
  /** Spread of the size roll around that mean, 1 = authored jitter. 0 = every
   *  tree the same size; 2-3 = a real mix from saplings to giants. */
  readonly treeScaleVariance: number;
  /** 0..1 — skews the per-instance scale roll toward the small end, so forests
   *  read younger (many small trees between the tall ones). 0 = uniform. */
  readonly youngTrees: number;

  // ── Wiesen & Lichtungen ──
  /** Extra flower density on MEADOWS (multiplies the flower category's
   *  Grassland affinity), 1 = neutral. */
  readonly flowerMeadow: number;
  /** Extra bush/shrub density on MEADOWS (undergrowth category × Grassland). */
  readonly bushMeadow: number;
  /** How strongly clearing-loving species (flowers, bushes) bloom ON clearings —
   *  scales every `clearingLover` gain, 1 = authored. */
  readonly flowerClearing: number;

  // ── Gruppierung (clumped spawning) ──
  // Strength 0..1 pulls a category out of uniform scatter into clumps (0 = as
  // authored, 1 = only inside clumps, denser there); size = clump wavelength (m).
  readonly bushCluster: number;
  readonly bushClusterSize: number;
  readonly flowerCluster: number;
  readonly flowerClusterSize: number;
  readonly mushroomCluster: number;
  readonly mushroomClusterSize: number;

  // ── Steine ──
  /** 0..1 — rocks prefer steep ground ("an Abhängen"): 0 = as authored,
   *  1 = strongly concentrated on slopes, thinned on flats. */
  readonly rockSlopeBias: number;

  // ── Gras (the GPU grass field) ──
  /** Blade height multiplier (scales uBladeHeightMin/Max), 1 = authored. */
  readonly grassHeight: number;
  /** Per-biome grass density multipliers, 1 = authored affinity. */
  readonly grassMeadow: number;
  readonly grassForest: number;
  readonly grassTaiga: number;
  readonly grassHills: number;

  /** Baseline wind sway (was the SWAY_BASE constant). */
  readonly swayStrength: number;
  /** Advanced: per-species absolute cap overrides (bypass the category maths). */
  readonly speciesCap: Partial<Record<SpeciesId, number>>;
}

export interface FaunaConfig {
  /** Number of independent bird flocks (rebuild on change). */
  readonly flockCount: number;
  /** Inclusive random bird-count range rolled independently per flock. */
  readonly birdMinPerFlock: number;
  readonly birdMaxPerFlock: number;
  /** Multiplier on the flock roam-ring radii (live). */
  readonly roamScale: number;
  /** Multiplier on min/max flight speed (live). */
  readonly flightSpeed: number;
  /** Number of independent bat flocks (rebuild on change). */
  readonly batFlockCount: number;
  /** Inclusive random bat-count range rolled independently per flock. */
  readonly batMinPerFlock: number;
  readonly batMaxPerFlock: number;
  /** Bat roam-ring multiplier (live). */
  readonly batRoamScale: number;
  /** Bat min/max flight-speed multiplier (live). */
  readonly batFlightSpeed: number;
  /** Number of independent meise (tit) flocks — fly at treetop height and below. */
  readonly meiseFlockCount: number;
  readonly meiseMinPerFlock: number;
  readonly meiseMaxPerFlock: number;
  /** Meise roam-ring multiplier (live). */
  readonly meiseRoamScale: number;
  /** Meise min/max flight-speed multiplier (live). */
  readonly meiseFlightSpeed: number;
  /** Number of butterfly clusters — flit very low, near flowers and bushes. */
  readonly butterflyFlockCount: number;
  readonly butterflyMinPerFlock: number;
  readonly butterflyMaxPerFlock: number;
  /** Butterfly roam-ring multiplier (live). */
  readonly butterflyRoamScale: number;
  /** Butterfly min/max flight-speed multiplier (live). */
  readonly butterflyFlightSpeed: number;
  /** Number of persistent, ground-near mosquito swarms. */
  readonly mosquitoSwarmCount: number;
  /** Inclusive random mosquito-count range rolled independently per swarm. */
  readonly mosquitoMinPerSwarm: number;
  readonly mosquitoMaxPerSwarm: number;
  /** Multiplier on the compact local mosquito-cloud radius (live). */
  readonly mosquitoSpread: number;
  /** Multiplier on the mosquitoes' internal buzzing speed (live). */
  readonly mosquitoFlightSpeed: number;
  /** Mushroom spawn-point count (live: re-scatter). */
  readonly mushroomCount: number;
  /** Mushroom scatter radius in metres (live). */
  readonly mushroomRadius: number;
  /** Number of animated deer roaming on the streamed terrain. */
  readonly deerCount: number;
  /** Multiplier on the deer's normalized real-world size. */
  readonly deerScale: number;
  /** Deer walking speed in metres per second. */
  readonly deerSpeed: number;
  /** Radius around the player in which deer choose new routes. */
  readonly deerRoamRadius: number;
  /** Extra clearance kept between a deer route and tree trunks, in metres. */
  readonly deerTreeClearance: number;
  /** Number of animated foxes roaming the streamed terrain (they walk like the deer). */
  readonly foxCount: number;
  /** Multiplier on the fox's normalized real-world size. */
  readonly foxScale: number;
  /** Fox walking speed in metres per second. */
  readonly foxSpeed: number;
  /** Radius around each fox's home in which it chooses new routes. */
  readonly foxRoamRadius: number;
  /** Extra clearance kept between a fox route and tree trunks, in metres. */
  readonly foxTreeClearance: number;
}

export interface FloraFaunaConfig {
  readonly flora: FloraConfig;
  readonly fauna: FaunaConfig;
}

/** The shipped defaults — the values the world was hand-tuned to before the panel
 *  existed. `globalDensity` and the category multipliers all sit at 1 so the
 *  effective caps equal the species.ts base caps. */
export const DEFAULT_CONFIG: FloraFaunaConfig = {
  flora: {
    globalDensity: 1,
    treeDensity: 1,
    undergrowthDensity: 1,
    flowerDensity: 1,
    mushroomDensity: 1,
    rockDensity: 1,
    deadwoodDensity: 1,
    nadelAnteil: 0.5,
    mischBreite: 0.3,
    forestClearing: 0.5,
    forestZoneScale: 1,
    treeScale: 1,
    treeScaleVariance: 1,
    youngTrees: 0,
    flowerMeadow: 1,
    bushMeadow: 1,
    flowerClearing: 1,
    bushCluster: 0,
    bushClusterSize: 24,
    flowerCluster: 0,
    flowerClusterSize: 18,
    mushroomCluster: 0,
    mushroomClusterSize: 14,
    rockSlopeBias: 0,
    grassHeight: 1,
    grassMeadow: 1,
    grassForest: 1,
    grassTaiga: 1,
    grassHills: 1,
    swayStrength: 0.5,
    speciesCap: {},
  },
  fauna: {
    flockCount: 4,
    birdMinPerFlock: 18,
    birdMaxPerFlock: 30,
    roamScale: 1,
    flightSpeed: 1,
    batFlockCount: 2,
    batMinPerFlock: 8,
    batMaxPerFlock: 16,
    batRoamScale: 1,
    batFlightSpeed: 1,
    meiseFlockCount: 3,
    meiseMinPerFlock: 4,
    meiseMaxPerFlock: 9,
    meiseRoamScale: 1,
    meiseFlightSpeed: 1,
    butterflyFlockCount: 5,
    butterflyMinPerFlock: 3,
    butterflyMaxPerFlock: 7,
    butterflyRoamScale: 1,
    butterflyFlightSpeed: 1,
    mosquitoSwarmCount: 4,
    mosquitoMinPerSwarm: 80,
    mosquitoMaxPerSwarm: 160,
    mosquitoSpread: 1,
    mosquitoFlightSpeed: 1,
    mushroomCount: 24,
    mushroomRadius: 90,
    deerCount: 3,
    deerScale: 1,
    deerSpeed: 1.2,
    deerRoamRadius: 110,
    deerTreeClearance: 3,
    foxCount: 4,
    foxScale: 0.02,
    foxSpeed: 1.9,
    foxRoamRadius: 95,
    foxTreeClearance: 2,
  },
};

const CATEGORY_KEY: Record<FloraCategory, keyof FloraConfig> = {
  tree: "treeDensity",
  undergrowth: "undergrowthDensity",
  flower: "flowerDensity",
  mushroom: "mushroomDensity",
  rock: "rockDensity",
  deadwood: "deadwoodDensity",
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Keep runtime allocation/count controls inside the capacities exposed by the
 * dev console. This also protects booted state files and non-UI bus producers. */
export function normalizeFaunaConfig(fauna: FaunaConfig): FaunaConfig {
  const count = (value: number, min: number, max: number): number =>
    clamp(Math.round(value), min, max);
  return {
    ...fauna,
    flockCount: count(fauna.flockCount, 1, 48),
    birdMinPerFlock: count(fauna.birdMinPerFlock, 1, 80),
    birdMaxPerFlock: count(fauna.birdMaxPerFlock, 1, 80),
    batFlockCount: count(fauna.batFlockCount, 1, 48),
    batMinPerFlock: count(fauna.batMinPerFlock, 1, 80),
    batMaxPerFlock: count(fauna.batMaxPerFlock, 1, 80),
    meiseFlockCount: count(fauna.meiseFlockCount, 0, 48),
    meiseMinPerFlock: count(fauna.meiseMinPerFlock, 1, 120),
    meiseMaxPerFlock: count(fauna.meiseMaxPerFlock, 1, 120),
    butterflyFlockCount: count(fauna.butterflyFlockCount, 0, 80),
    butterflyMinPerFlock: count(fauna.butterflyMinPerFlock, 1, 80),
    butterflyMaxPerFlock: count(fauna.butterflyMaxPerFlock, 1, 80),
    mosquitoSwarmCount: count(fauna.mosquitoSwarmCount, 0, 48),
    mosquitoMinPerSwarm: count(fauna.mosquitoMinPerSwarm, 1, 400),
    mosquitoMaxPerSwarm: count(fauna.mosquitoMaxPerSwarm, 1, 400),
    mushroomCount: count(fauna.mushroomCount, 0, 480),
    deerCount: count(fauna.deerCount, 0, 64),
    foxCount: count(fauna.foxCount, 0, 96),
  };
}

/** The base cap × global × category multiplier (or an explicit per-species
 *  override), rounded and clamped to `[0, baseCap × MAX_DENSITY]` so it never
 *  exceeds the pre-sized instance buffers. */
export function effectiveCap(id: SpeciesId, flora: FloraConfig): number {
  const base = SPECIES[id].perChunkCap;
  const override = flora.speciesCap[id];
  const raw =
    override !== undefined
      ? override
      : base * flora.globalDensity * (flora[CATEGORY_KEY[SPECIES_CATEGORY[id]]] as number);
  return clamp(Math.round(raw), 0, base * MAX_DENSITY);
}

/** The buffer-sizing cap: the most instances a species could ever need, so its
 *  packed instance buffers are allocated once and density edits never realloc. */
export function reserveCap(id: SpeciesId): number {
  return Math.ceil(SPECIES[id].perChunkCap * MAX_DENSITY);
}
