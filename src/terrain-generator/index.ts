export interface Terrain {
  readonly width: number;
  readonly height: number;
  /** Row-major heightfield, each value in [0, 1]. */
  readonly heights: Float32Array;
}

/**
 * Deterministic value-noise terrain. Replace with the real generator later;
 * this exists so the renderer has something to draw end-to-end.
 */
export function generateTerrain(width: number, height: number, seed = 1): Terrain {
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      heights[y * width + x] = sample(x, y, seed);
    }
  }
  return { width, height, heights };
}

function sample(x: number, y: number, seed: number): number {
  const nx = x * 0.06;
  const ny = y * 0.06;
  const v =
    Math.sin(nx + seed) * 0.5 +
    Math.sin(ny * 1.3 + seed * 0.7) * 0.3 +
    Math.sin((nx + ny) * 0.7) * 0.2;
  return (v + 1) / 2;
}
