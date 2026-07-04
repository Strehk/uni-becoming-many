// ── Becoming Many — Generic Wave Function Collapse Solver ──────
//
// Domains are bitmasks over ≤32 tiles (Uint32). Standard loop: min-entropy pick →
// weighted collapse → constraint propagation. Border cells can be pre-pinned so
// adjacent regions agree at the seam. On a contradiction it restarts; if every
// restart fails it falls back to the per-cell argmax prior so a plan is always
// produced.
//
// GENERIC — the tile count, adjacency table and full-domain mask all arrive on the
// input, so the SAME solver drives Pass A (biomes) and Pass B (landforms). PURE
// CPU — no three, no DOM.

export interface WfcInput {
  w: number;
  h: number;
  /** Number of distinct tiles (≤ 32). */
  tileCount: number;
  /** compatMask[t] = bitmask of tiles compatible as a neighbour of t. */
  compatMask: number[];
  /** Bitmask with every tile bit set (`(1<<tileCount)-1`). */
  fullDomain: number;
  /** length w*h*tileCount, per-cell prior weight for each tile. */
  priors: Float32Array;
  /** length w*h, tile id to pin, or -1 for free. */
  pinned: Int16Array;
  rng: () => number;
  maxRestarts?: number;
}

function popcount(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >> 24) & 0x3f;
}

export class WfcSolver {
  solve(input: WfcInput): Uint8Array {
    const { w, h, priors, pinned, rng, tileCount, compatMask, fullDomain } = input;
    const maxRestarts = input.maxRestarts ?? 12;
    const n = w * h;

    for (let attempt = 0; attempt < maxRestarts; attempt++) {
      const domain = new Uint32Array(n);
      const stack: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = pinned[i] ?? -1;
        if (p >= 0) {
          domain[i] = 1 << p;
          stack.push(i);
        } else {
          domain[i] = fullDomain;
        }
      }
      if (!this.propagate(domain, stack, w, h, tileCount, compatMask)) continue;

      let ok = true;
      for (;;) {
        const cell = this.pickMinEntropy(domain, n, rng);
        if (cell < 0) break; // all collapsed
        this.collapse(domain, priors, cell, rng, tileCount);
        if (!this.propagate(domain, [cell], w, h, tileCount, compatMask)) {
          ok = false;
          break;
        }
      }
      if (ok) return this.extract(domain, n);
    }

    console.warn(`[WFC] all ${maxRestarts} attempts hit a contradiction — using argmax fallback`);
    return this.fallback(priors, n, tileCount);
  }

  private unionMask(d: number, tileCount: number, compatMask: number[]): number {
    let u = 0;
    for (let t = 0; t < tileCount; t++) if (d & (1 << t)) u |= compatMask[t] ?? 0;
    return u;
  }

  private propagate(
    domain: Uint32Array,
    stack: number[],
    w: number,
    h: number,
    tileCount: number,
    compatMask: number[],
  ): boolean {
    while (stack.length > 0) {
      const i = stack.pop();
      if (i === undefined) break;
      const allowed = this.unionMask(domain[i] ?? 0, tileCount, compatMask);
      const x = i % w;
      const y = (i / w) | 0;
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      for (const nb of neighbors) {
        if (nb < 0) continue;
        const cur = domain[nb] ?? 0;
        const next = cur & allowed;
        if (next === 0) return false;
        if (next !== cur) {
          domain[nb] = next;
          stack.push(nb);
        }
      }
    }
    return true;
  }

  private pickMinEntropy(domain: Uint32Array, n: number, rng: () => number): number {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const c = popcount(domain[i] ?? 0);
      if (c <= 1) continue;
      const score = c + rng() * 0.5; // tiny noise to break ties deterministically
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private collapse(
    domain: Uint32Array,
    priors: Float32Array,
    cell: number,
    rng: () => number,
    tileCount: number,
  ): void {
    const d = domain[cell] ?? 0;
    const base = cell * tileCount;
    let total = 0;
    for (let t = 0; t < tileCount; t++) if (d & (1 << t)) total += priors[base + t] ?? 0;
    let r = rng() * total;
    let chosen = -1;
    for (let t = 0; t < tileCount; t++) {
      if (!(d & (1 << t))) continue;
      r -= priors[base + t] ?? 0;
      if (r <= 0) {
        chosen = t;
        break;
      }
    }
    if (chosen < 0) {
      // numerical fallthrough: pick the highest set bit
      for (let t = tileCount - 1; t >= 0; t--)
        if (d & (1 << t)) {
          chosen = t;
          break;
        }
    }
    domain[cell] = chosen >= 0 ? 1 << chosen : d;
  }

  private extract(domain: Uint32Array, n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = 31 - Math.clz32(domain[i] ?? 0);
    return out;
  }

  private fallback(priors: Float32Array, n: number, tileCount: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const base = i * tileCount;
      let best = 0;
      for (let t = 1; t < tileCount; t++)
        if ((priors[base + t] ?? 0) > (priors[base + best] ?? 0)) best = t;
      out[i] = best;
    }
    return out;
  }
}
