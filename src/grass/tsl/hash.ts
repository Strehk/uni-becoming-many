// ── Becoming Many — Grass PCG Hashes ───────────────────────────
//
// Integer PCG hashing (no sin/mod) → stable, non-repeating per-grid-cell randomness.
// The blade grid is keyed on the GLOBAL grid index (`iGrid + uGridIndex`), so a blade
// hashes the same value regardless of where the camera-centred patch has snapped —
// this is what keeps the grass world-stable (no swimming) across snaps.
//
// Ported verbatim from momentchan/false-earth `components/grass/core/shaderHelpers.ts`.

import { Fn, float, uint, vec2 } from "three/tsl";
import type { IntNode, UintNode } from "./nodes.ts";

const PCG_MUL = 747796405;
const PCG_ADD = 2891336453;
const PCG_OUT = 277803737;
const PCG_MAX = 4294967295.0;

/** uint → pseudo-random float in [0, 1). */
export const pcgHash = Fn(([u]: [UintNode]) => {
  const state = uint(u).mul(uint(PCG_MUL)).add(uint(PCG_ADD));
  const w0 = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state);
  const w1 = w0.mul(uint(PCG_OUT));
  const w2 = w1.shiftRight(uint(22)).bitXor(w1);
  return float(w2).div(float(PCG_MAX));
});

/** (int, int) → float in [0, 1). */
export const hash2to1 = Fn(([x, y]: [IntNode, IntNode]) => {
  const seed = uint(x)
    .mul(uint(1597334677))
    .add(uint(y).mul(uint(3812015801)));
  return pcgHash(seed);
});

/** (int, int) → vec2 in [0, 1)². */
export const hash2to2 = Fn(([x, y]: [IntNode, IntNode]) => {
  const seed1 = uint(x)
    .mul(uint(1597334677))
    .add(uint(y).mul(uint(3812015801)));
  const seed2 = uint(x)
    .mul(uint(3812015801))
    .add(uint(y).mul(uint(1597334677)));
  return vec2(pcgHash(seed1), pcgHash(seed2));
});
