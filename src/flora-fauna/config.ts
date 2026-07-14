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
 *  factor. Raising it costs VRAM (buffers scale with it), notably on Quest VR. */
export const MAX_DENSITY = 2;

export type FloraCategory = "tree" | "undergrowth" | "flower" | "mushroom" | "rock";

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
  undergrowth: ["bush", "bush-2", "berry-bush", "shrub", "cactus"],
  flower: ["flower", "flower-2", "wheat", "reeds"],
  mushroom: ["mushroom-brown", "mushroom-red", "mushroom-white", "mushroom-cluster"],
  rock: [
    "rock",
    "rock-small",
    "rock-huge",
    "moss-rock",
    "stump",
    "stump-birch",
    "branch-pine",
    "branch-birch",
  ],
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
  /** Clearing amount 0..1 — higher = more/larger Lichtungen (opener forest);
   *  0.5 is neutral (the hand-tuned original). */
  readonly forestClearing: number;
  /** Scales the conifer↔deciduous zone size (× on the woodland type wavelength). */
  readonly forestZoneScale: number;
  /** Baseline wind sway (was the SWAY_BASE constant). */
  readonly swayStrength: number;
  /** Advanced: per-species absolute cap overrides (bypass the category maths). */
  readonly speciesCap: Partial<Record<SpeciesId, number>>;
}

export interface FaunaConfig {
  /** Number of independent bird flocks (rebuild on change). */
  readonly flockCount: number;
  /** Birds in each flock (rebuild on change). */
  readonly birdsPerFlock: number;
  /** Multiplier on the flock roam-ring radii (live). */
  readonly roamScale: number;
  /** Multiplier on min/max flight speed (live). */
  readonly flightSpeed: number;
  /** Mushroom spawn-point count (live: re-scatter). */
  readonly mushroomCount: number;
  /** Mushroom scatter radius in metres (live). */
  readonly mushroomRadius: number;
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
    forestClearing: 0.5,
    forestZoneScale: 1,
    swayStrength: 0.5,
    speciesCap: {},
  },
  fauna: {
    flockCount: 4,
    birdsPerFlock: 24,
    roamScale: 1,
    flightSpeed: 1,
    mushroomCount: 24,
    mushroomRadius: 90,
  },
};

const CATEGORY_KEY: Record<FloraCategory, keyof FloraConfig> = {
  tree: "treeDensity",
  undergrowth: "undergrowthDensity",
  flower: "flowerDensity",
  mushroom: "mushroomDensity",
  rock: "rockDensity",
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
