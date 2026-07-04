// ── Becoming Many — "Sine Hills" Terrain Provider ──────────────
//
// The default rolling-hills field (layered sines). Cheap; `seed` phase-shifts the
// field, `amplitude` scales it. (frequency / octaves are ignored — see ridged for
// those.) Pure math → runs in the worker.

import type { TerrainConfig, TerrainProvider } from "../provider.ts";

// Per-seed planar offset, so different seeds sample a different patch of field.
function seedOffset(seed: number): number {
  return seed * 0.137;
}

export const sineHillsProvider: TerrainProvider = {
  id: "sineHills",
  label: "Sine Hills",
  defaultConfig: { seed: 0, amplitude: 1, frequency: 1, octaves: 1 },

  height(x: number, z: number, cfg: TerrainConfig): number {
    const s = seedOffset(cfg.seed);
    const px = x + s;
    const pz = z + s;
    let h = 8.0 * Math.sin(px * 0.045) * Math.cos(pz * 0.05);
    h += 3.2 * Math.sin(px * 0.12 + 1.3) * Math.cos(pz * 0.1 - 0.7);
    h += 1.6 * Math.sin(px * 0.27 - 2.1) * Math.cos(pz * 0.31 + 0.4);
    h += 0.8 * Math.sin((px + pz) * 0.05);
    return h * cfg.amplitude;
  },
};
