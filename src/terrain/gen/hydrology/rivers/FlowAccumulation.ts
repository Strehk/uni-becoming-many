/**
 * Flow accumulation over the priority-flood drainage.
 *
 * Each cell starts with unit area; processing cells from highest filled height to
 * lowest (so every cell is handled before its downstream receiver) and pushing
 * each cell's accumulated area into its receiver yields the upstream catchment
 * area per cell. Merged tributaries naturally sum → bigger rivers downstream.
 */

export function flowAccumulation(
  filled: Float32Array,
  receiver: Int32Array,
  N: number,
): Float32Array {
  const accum = new Float32Array(N).fill(1);
  // Order cells by filled height, descending.
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => (filled[b] ?? 0) - (filled[a] ?? 0));
  for (let oi = 0; oi < N; oi++) {
    const i = order[oi] ?? 0;
    const r = receiver[i] ?? -1;
    if (r >= 0) accum[r] = (accum[r] ?? 0) + (accum[i] ?? 0);
  }
  return accum;
}
