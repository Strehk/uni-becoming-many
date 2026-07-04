/**
 * Priority-flood depression filling (Barnes et al. 2014).
 *
 * Floods inward from the grid boundary with a min-heap so that every cell ends
 * up with a `filled` height ≥ its terrain height and a `receiver` (downstream
 * neighbour) that leads, without ever going uphill, to the boundary. Depressions
 * are filled (filled > terrain) — those become lakes. Because the receiver of a
 * cell depends only on that cell and its 8 neighbours (a local function of the
 * global height field), the flow direction at a shared boundary is identical from
 * either region → rivers cross region seams consistently.
 */

/** Binary min-heap keyed by float priority over integer cell indices. */
class MinHeap {
  private idx: number[] = [];
  private key: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(i: number, k: number): void {
    this.idx.push(i);
    this.key.push(k);
    let c = this.idx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if ((this.key[p] ?? 0) <= (this.key[c] ?? 0)) break;
      this.swap(p, c);
      c = p;
    }
  }

  pop(): number {
    const top = this.idx[0] ?? -1;
    const lastI = this.idx.pop();
    const lastK = this.key.pop();
    if (lastI === undefined || lastK === undefined) return top;
    if (this.idx.length > 0) {
      this.idx[0] = lastI;
      this.key[0] = lastK;
      let p = 0;
      const n = this.idx.length;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let s = p;
        if (l < n && (this.key[l] ?? 0) < (this.key[s] ?? 0)) s = l;
        if (r < n && (this.key[r] ?? 0) < (this.key[s] ?? 0)) s = r;
        if (s === p) break;
        this.swap(s, p);
        p = s;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a] ?? 0;
    this.idx[a] = this.idx[b] ?? 0;
    this.idx[b] = ti;
    const tk = this.key[a] ?? 0;
    this.key[a] = this.key[b] ?? 0;
    this.key[b] = tk;
  }
}

export interface FloodResult {
  filled: Float32Array;
  receiver: Int32Array; // downstream cell index, or -1 for a boundary outlet
}

const NX = [-1, 1, 0, 0, -1, -1, 1, 1];
const NY = [0, 0, -1, 1, -1, 1, -1, 1];

export function priorityFlood(height: Float32Array, W: number, H: number): FloodResult {
  const N = W * H;
  const filled = new Float32Array(N);
  const receiver = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();

  // Seed the boundary ring as outlets.
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }

  function seed(x: number, y: number): void {
    const i = y * W + x;
    if (closed[i]) return;
    closed[i] = 1;
    filled[i] = height[i] ?? 0;
    receiver[i] = -1;
    heap.push(i, filled[i] ?? 0);
  }

  while (heap.size > 0) {
    const c = heap.pop();
    const cx = c % W;
    const cy = (c / W) | 0;
    const cf = filled[c] ?? 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + (NX[k] ?? 0);
      const ny = cy + (NY[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (closed[n]) continue;
      closed[n] = 1;
      const hn = height[n] ?? 0;
      filled[n] = hn > cf ? hn : cf;
      receiver[n] = c;
      heap.push(n, filled[n] ?? 0);
    }
  }

  return { filled, receiver };
}
