// ── Becoming Many — Grid Normals ───────────────────────────────
//
// Per-vertex normals from an EXTENDED height grid carrying a one-vertex apron of
// real neighbour heights on every side. Those apron heights are evaluated at the
// true world positions just outside the chunk — the same positions the adjacent
// chunk evaluates as its own interior — so edge normals match across chunk
// borders exactly. No lighting seams. PURE CPU — no three, no DOM.

/**
 * @param extY   (res+3)² extended height grid (world Y). ext index
 *               (ej*(res+3)+ei), where ei/ej ∈ [0,res+2] map to vertex i/j = ei-1.
 * @param res    grid segments per chunk edge (verts per edge = res+1).
 * @param step   world-units between adjacent vertices.
 * @returns      Float32Array of (res+1)² × 3 normals, row-major by vertex (i,j).
 */
export function computeGridNormals(extY: Float32Array, res: number, step: number): Float32Array {
  const vpe = res + 1; // verts per edge
  const ew = res + 3; // extended width
  const out = new Float32Array(vpe * vpe * 3);
  const inv2 = 1 / (2 * step);
  for (let j = 0; j <= res; j++) {
    const ej = j + 1;
    for (let i = 0; i <= res; i++) {
      const ei = i + 1;
      const yL = extY[ej * ew + (ei - 1)] ?? 0;
      const yR = extY[ej * ew + (ei + 1)] ?? 0;
      const yD = extY[(ej - 1) * ew + ei] ?? 0;
      const yU = extY[(ej + 1) * ew + ei] ?? 0;
      // Gradient of the height field; normal = normalize(-dY/dx, 1, -dY/dz).
      const gx = (yR - yL) * inv2;
      const gz = (yU - yD) * inv2;
      const nx = -gx;
      const ny = 1;
      const nz = -gz;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const o = (j * vpe + i) * 3;
      out[o] = nx / len;
      out[o + 1] = ny / len;
      out[o + 2] = nz / len;
    }
  }
  return out;
}
