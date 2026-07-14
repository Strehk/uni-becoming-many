// ── Becoming Many — Woodland Structure ─────────────────────────
//
// Splits the single `Forest` biome into Nadelwald / Laubwald / Mischwald zones and
// carves occasional Lichtungen (clearings), WITHOUT touching the biome enum or the
// worker protocol: these are pure, deterministic weight fields over world XZ that
// species defs fold into their scatter probability (`SpeciesDef.placement`).
//
// PURE DATA/MATH — no three, no GPU, fixed seeds. Same contract as species.ts:
// the scatter algorithm calls this per candidate, so everything here is a handful
// of hashes and lerps. Deterministic — the same coordinates always answer the same.
//
// Scale intuition: forest-type zones are ~180 m across (several chunks — you fly
// through a Tannenwald, then a mixed band, then a Laubwald), clearings ~60 m
// (sub-chunk pockets where the canopy opens and flowers take over).

/** Wavelength of the conifer↔deciduous zoning, metres. */
const TYPE_WAVELENGTH = 180;
/** Wavelength of the clearing field, metres. */
const CLEARING_WAVELENGTH = 60;

const TYPE_SEED = 0x9e37;
const CLEARING_SEED = 0x51ed;

/** Base clearing threshold edges — the `lichtung` smoothstep band at neutral
 *  config (0.62..0.72 = the hand-tuned original). */
const CLEARING_EDGE_LO = 0.62;
const CLEARING_EDGE_HI = 0.72;

/** Live woodland tuning (the flora config drives this via `setWoodlandConfig`).
 *  `clearingBias` shifts the threshold (positive = fewer clearings, denser
 *  forest); `typeWavelengthScale` scales the conifer↔deciduous zone size. */
const config = { clearingBias: 0, typeWavelengthScale: 1 };

/** Map the config's `forestClearing` (0..1, higher = more open) + `forestZoneScale`
 *  onto the live woodland state. `forestClearing = 0.5` is neutral. */
export function setWoodlandConfig(opts: { forestClearing: number; forestZoneScale: number }): void {
  // More clearings ⇒ lower threshold. Range ±0.3 keeps the smoothstep valid.
  config.clearingBias = (0.5 - opts.forestClearing) * 0.6;
  config.typeWavelengthScale = Math.max(0.1, opts.forestZoneScale);
}

/** Integer-lattice hash → [0, 1). Splitmix-style avalanche, cheap and stable. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Value noise: bilinear over the integer lattice with smoothstep fade. */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Two octaves — enough character for zone borders without visible lattice grain. */
function fbm2(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed) * 2 + valueNoise(x * 2.7 + 31.4, z * 2.7 - 17.2, seed)) / 3;
}

/** Conifer share at this point, 0..1 — 1 deep in a Tannenwald, 0 in a Laubwald,
 *  a smooth Mischwald band in between (where both weights are mid-range). */
export function nadelWeight(x: number, z: number): number {
  const wavelength = TYPE_WAVELENGTH * config.typeWavelengthScale;
  const n = fbm2(x / wavelength, z / wavelength, TYPE_SEED);
  return 1 - smoothstep(0.35, 0.65, n);
}

/** Deciduous share — the complement of {@link nadelWeight}. */
export function laubWeight(x: number, z: number): number {
  return 1 - nadelWeight(x, z);
}

/** Clearing factor 0..1 — 0 under closed canopy, rising to 1 in occasional open
 *  pockets. Trees multiply by `1 - lichtung`, flowers/bushes by `1 + lichtung·k`. */
export function lichtung(x: number, z: number): number {
  const n = fbm2(x / CLEARING_WAVELENGTH, z / CLEARING_WAVELENGTH, CLEARING_SEED);
  return smoothstep(
    CLEARING_EDGE_LO + config.clearingBias,
    CLEARING_EDGE_HI + config.clearingBias,
    n,
  );
}
