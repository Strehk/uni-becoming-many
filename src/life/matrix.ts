// ── Becoming Many — Instance Matrix Composition ────────────────
//
// Writes a TRS transform straight into an InstancedMesh's `instanceMatrix` backing
// array, in three's COLUMN-MAJOR element order. Reproduces `Matrix4.compose()` with
// an XYZ-Euler rotation, without importing three — so scatter stays a pure
// numerical routine (and could be lifted into a worker unchanged).
//
// Concept-ported from neural-flight-template's sinneswandler `decoration-data.ts`.

const TAU = Math.PI * 2;
export { TAU };

/**
 * Compose translation × rotation(XYZ Euler) × scale into `out` at `offset`
 * (which must be a multiple of 16).
 */
export function composeMatrix(
  out: Float32Array,
  offset: number,
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const c1 = Math.cos(rx);
  const s1 = Math.sin(rx);
  const c2 = Math.cos(ry);
  const s2 = Math.sin(ry);
  const c3 = Math.cos(rz);
  const s3 = Math.sin(rz);

  const ae = c1 * c3;
  const af = c1 * s3;
  const be = s1 * c3;
  const bf = s1 * s3;

  out[offset + 0] = c2 * c3 * sx;
  out[offset + 1] = (af + be * s2) * sx;
  out[offset + 2] = (bf - ae * s2) * sx;
  out[offset + 3] = 0;

  out[offset + 4] = -c2 * s3 * sy;
  out[offset + 5] = (ae - bf * s2) * sy;
  out[offset + 6] = (be + af * s2) * sy;
  out[offset + 7] = 0;

  out[offset + 8] = s2 * sz;
  out[offset + 9] = -s1 * c2 * sz;
  out[offset + 10] = c1 * c2 * sz;
  out[offset + 11] = 0;

  out[offset + 12] = px;
  out[offset + 13] = py;
  out[offset + 14] = pz;
  out[offset + 15] = 1;
}

/** A deterministic 32-bit PRNG. Same seed ⇒ same world, forever. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a chunk cell and a species index into a stable seed. */
export function chunkSeed(gridX: number, gridZ: number, speciesIndex: number): number {
  return (gridX * 73856093) ^ (gridZ * 19349663) ^ (speciesIndex * 83492791);
}
