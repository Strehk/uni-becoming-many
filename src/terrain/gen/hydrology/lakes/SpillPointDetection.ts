/**
 * Spill (outlet) points of flooded basins.
 *
 * After priority-flood, a lake cell whose receiver is NOT a lake cell is the
 * saddle where the basin overflows — the spill point from which the river
 * continues downstream. These are surfaced as overlay markers.
 */
export function findSpillPoints(lakeMask: Uint8Array, receiver: Int32Array, N: number): number[] {
  const spills: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!lakeMask[i]) continue;
    const r = receiver[i] ?? -1;
    if (r < 0 || (lakeMask[r] ?? 0) === 0) spills.push(i);
  }
  return spills;
}
