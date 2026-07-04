// ── Becoming Many — Slope Map ──────────────────────────────────
//
// Slope map from a height field (central differences, normalised to 0..1). Edge
// cells clamp to their in-bounds neighbour; a later apron pass removes the small
// edge error. PURE CPU — no three, no DOM.

export function computeSlope(height: Float32Array, size: number, strength = 90): Float32Array {
  const slope = new Float32Array(size * size);
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= size ? size - 1 : x;
    const cy = y < 0 ? 0 : y >= size ? size - 1 : y;
    return height[cy * size + cx] ?? 0;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const mag = Math.sqrt(dx * dx + dy * dy);
      slope[y * size + x] = Math.min(1, mag * strength);
    }
  }
  return slope;
}
