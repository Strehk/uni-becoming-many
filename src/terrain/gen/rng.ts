// ── Becoming Many — Deterministic Seeding ──────────────────────
//
// The whole world is reproducible from a single integer seed. Two kinds of
// randomness:
//   - Sequential PRNG streams (mulberry32) for ordered algorithms like WFC.
//   - Stateless coordinate hashes (hash2D) for per-position jitter that must be
//     identical no matter which chunk/region evaluates it — this keeps chunk
//     borders seamless.

/** FNV-1a 32-bit hash of a string → uint32 seed. */
export function hashStringToSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG: fast, deterministic, good enough for procedural use. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Avalanche-combine any number of integers into a uint32. Order matters. */
export function hashCombine(...vals: number[]): number {
  let h = 0x9e3779b9 >>> 0;
  for (const raw of vals) {
    h ^= raw | 0;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Stateless [0,1) value from integer coordinates + seed. */
export function hash2D(x: number, y: number, seed: number): number {
  return hashCombine(x, y, seed) / 4294967296;
}

/** Derive a child seed from a parent seed and some discriminators. */
export function deriveSeed(seed: number, ...parts: number[]): number {
  return hashCombine(seed, ...parts);
}

/**
 * Convert a numeric seed into a large 2D coordinate offset. Sampling the same
 * noise function at p + offset gives a different-but-coherent world per seed,
 * while remaining a pure function of world position (so it stays seamless).
 */
export function seedToOffset(seed: number): [number, number] {
  const ox = (hashCombine(seed, 0x1a2b) % 1_000_000) + 0.5;
  const oy = (hashCombine(seed, 0x3c4d) % 1_000_000) + 0.5;
  return [ox * 1.37, oy * 1.91];
}
