/**
 * Traces river polylines from the priority-flood drainage.
 *
 * Channels are cells whose accumulated flow exceeds a threshold. From each
 * channel "head" (no upstream channel) we walk downstream along the receiver
 * chain — which by construction never goes uphill — accumulating points until the
 * river reaches the ocean, a lake, the block boundary (continues into the next
 * region), or merges into an already-traced channel. Tributaries that merge sum
 * their flow, so the trunk widens downstream.
 *
 * Tracing runs on a 3×3-region block so rivers entering a region from its
 * neighbours are captured; only paths that pass through the region interior are
 * kept (the neighbour regions own the rest), which keeps rivers continuous and
 * correctly sized across region seams.
 */
import type { GenParams, RiverNetwork, RiverPath, RiverPoint } from "../../mapTypes.ts";
import { valueNoise2D } from "../../noise.ts";
import { emptyNetwork } from "./RiverNetwork.ts";
import { flowToDepth, flowToWidth } from "./RiverPath.ts";

export interface TraceInput {
  filled: Float32Array;
  receiver: Int32Array;
  accum: Float32Array;
  lakeMask: Uint8Array;
  srcAllowed: Uint8Array; // 1 where the WFC plan allows a river to rise (upland)
  W: number; // block width = 3*RM
  H: number;
  blockOriginMx: number; // global macro x of block cell (0,0)
  blockOriginMy: number;
  cs: number; // macro cell size in world px
  seaLevel: number;
  // Region interior world rect (paths intersecting it are kept).
  rectMinX: number;
  rectMinY: number;
  rectMaxX: number;
  rectMaxY: number;
  params: GenParams;
  seed: number;
}

const NX = [-1, 1, 0, 0, -1, -1, 1, 1];
const NY = [0, 0, -1, 1, -1, 1, -1, 1];

export function traceRivers(input: TraceInput): RiverNetwork {
  const { filled, receiver, accum, lakeMask, srcAllowed, W, H, cs, seaLevel, params, seed } = input;
  const N = W * H;
  const threshold = 22 / Math.max(0.2, params.riverDensity);
  const meander = params.riverMeanderStrength;
  const mf = 1 / (cs * 3);
  // Source bias: in non-upland cells a headwater only becomes visible once its
  // flow is `visibleMul`× the channel threshold. bias 0 → everything visible
  // (pure hydrology); bias 1 → small lowland streams are hidden until they grow
  // or reach upland, so rivers appear to rise in hills/mountains. The river still
  // flows to its true terminus — only the upstream start is trimmed (no dead-ends).
  const visibleMul = 1 + params.riverSourceBias * 8;
  // Rivers stay invisible while above this height, so the visible channel only
  // begins once it has descended out of steep mountain terrain (flat ribbons
  // draped down a mountainside looked wrong). The river still flows to its true
  // terminus — only the high headwater is trimmed.
  const maxHeight = params.riverMaxHeight;

  const isChannel = (i: number): boolean =>
    (accum[i] ?? 0) >= threshold && (filled[i] ?? 0) >= seaLevel && (lakeMask[i] ?? 0) === 0;

  // Collect heads (channel cells with no upstream channel).
  const heads: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!isChannel(i)) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let hasUpstream = false;
    for (let k = 0; k < 8 && !hasUpstream; k++) {
      const nx = x + (NX[k] ?? 0);
      const ny = y + (NY[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if ((receiver[j] ?? -1) === i && isChannel(j)) hasUpstream = true;
    }
    if (!hasUpstream) heads.push(i);
  }
  // Largest rivers first so the main stem owns the shared downstream trunk.
  heads.sort((a, b) => (accum[b] ?? 0) - (accum[a] ?? 0));

  const net = emptyNetwork();
  const visited = new Uint8Array(N);

  const worldOf = (i: number): { x: number; y: number } => {
    const gx = i % W;
    const gy = (i / W) | 0;
    const wx = (input.blockOriginMx + gx + 0.5) * cs;
    const wy = (input.blockOriginMy + gy + 0.5) * cs;
    const ox = (valueNoise2D(wx * mf, wy * mf, seed) - 0.5) * cs * meander;
    const oy = (valueNoise2D(wx * mf + 91.3, wy * mf + 17.7, seed ^ 0x9e37) - 0.5) * cs * meander;
    return { x: wx + ox, y: wy + oy };
  };
  const inRect = (p: { x: number; y: number }): boolean =>
    p.x >= input.rectMinX && p.x < input.rectMaxX && p.y >= input.rectMinY && p.y < input.rectMaxY;

  // A cell's headwater is "visible" if the WFC plan allows a source here, or its
  // flow has grown past the bias threshold.
  const visible = (i: number): boolean =>
    (srcAllowed[i] ?? 0) === 1 || (accum[i] ?? 0) >= threshold * visibleMul;

  for (const head of heads) {
    if (visited[head]) continue;
    const points: RiverPoint[] = [];
    let cur = head;
    let terminus: RiverPath["terminus"] = "boundary";
    let touchesRect = false;
    let started = false;
    let source: { x: number; y: number } | null = null;

    const emit = (i: number, depth: number): void => {
      const w = worldOf(i);
      const width = flowToWidth(accum[i] ?? 0, threshold, params);
      points.push({
        x: w.x,
        y: w.y,
        flow: accum[i] ?? 0,
        width,
        depth: depth < 0 ? flowToDepth(width, params) : depth,
      });
      if (inRect(w)) touchesRect = true;
    };

    for (let guard = 0; guard < N; guard++) {
      // Gate the visible start of the river (only trims the upstream head):
      // requires both the flow/upland visibility test and a drop below the
      // mountain cutoff, so no river ribbon is drawn on high steep terrain.
      if (!started && visible(cur) && (filled[cur] ?? 0) <= maxHeight) {
        started = true;
        const w = worldOf(cur);
        if (inRect(w)) source = w;
      }
      if (started) emit(cur, -1);

      const r = receiver[cur] ?? -1;
      if (r < 0) {
        terminus = "boundary";
        break;
      }
      if ((filled[r] ?? 0) < seaLevel) {
        if (started) emit(r, 0);
        terminus = "ocean";
        break;
      }
      if (lakeMask[r]) {
        if (started) emit(r, 0);
        terminus = "lake";
        break;
      }
      visited[cur] = 1;
      if (visited[r]) {
        if (started) emit(r, -1);
        terminus = "merge";
        break;
      }
      cur = r;
    }

    if (points.length >= 2 && touchesRect) {
      net.paths.push({ points, terminus });
      if (source) net.sources.push(source);
    }
  }

  return net;
}
