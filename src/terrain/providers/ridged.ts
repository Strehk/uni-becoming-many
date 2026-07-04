// ── Becoming Many — "Ridged Peaks" Terrain Provider ────────────
//
// A domain-warped, multi-octave RIDGED field (sharp crests via 1 - |sin·cos|).
// `octaves` adds finer ridges, `frequency` scales feature size, `amplitude` the
// height, `seed` offsets. Pure math → runs in the worker.

import type { TerrainConfig, TerrainProvider } from "../provider.ts";

const BASE_AMP = 18; // first-octave height (metres) at amplitude = 1
const BASE_FREQ = 0.012; // first-octave frequency at frequency = 1
const WARP = 14; // domain-warp strength (metres)
const LACUNARITY = 2.07;
const GAIN = 0.5;

function octaveCount(cfg: TerrainConfig): number {
  return Math.max(1, Math.min(6, Math.round(cfg.octaves)));
}

// One ridged octave in [0, 1]: 1 - |sin(x·f)·cos(z·f)| → sharp crests at the zeros.
function ridge(x: number, z: number, freq: number): number {
  return 1 - Math.abs(Math.sin(x * freq) * Math.cos(z * freq));
}

export const ridgedProvider: TerrainProvider = {
  id: "ridged",
  label: "Ridged Peaks",
  defaultConfig: { seed: 0, amplitude: 1, frequency: 1, octaves: 4 },

  height(x: number, z: number, cfg: TerrainConfig): number {
    const s = cfg.seed * 0.211;
    const f0 = BASE_FREQ * cfg.frequency;
    const wx = x + s + Math.sin(z * 0.02 * cfg.frequency) * WARP;
    const wz = z + s + Math.sin(x * 0.02 * cfg.frequency) * WARP;

    const n = octaveCount(cfg);
    let amp = BASE_AMP;
    let freq = f0;
    let h = ridge(wx, wz, freq) * amp;
    for (let o = 1; o < n; o++) {
      amp *= GAIN;
      freq *= LACUNARITY;
      h += ridge(wx, wz, freq) * amp;
    }
    return h * cfg.amplitude;
  },
};
