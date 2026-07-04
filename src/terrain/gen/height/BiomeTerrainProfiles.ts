// ── Becoming Many — Per-biome 3D Terrain Character ─────────────
//
// Two halves:
//   1. CONTINUOUS masks derived from the smooth fields (height, moisture,
//      temperature). They drive GEOMETRY amplitude and must stay continuous
//      across chunk borders (pure functions of seamless values, never the
//      discrete biome id which can flip by a pixel at a border).
//   2. A DISCRETE profile table keyed by Biome, used only for colour/material and
//      vegetation, where a one-pixel boundary difference is invisible.
//
// Amplitudes are in NORMALISED height units (same 0..1 scale as the Stage 1
// height map). PURE CPU — no three, no DOM.

import { Biome } from "../mapTypes.ts";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface TerrainMasks {
  landNorm: number; // 0 at sea level → 1 at peak land
  mountain: number; // high inland relief
  hill: number; // rolling mid-elevation
  lowland: number; // plains
  desert: number; // hot + dry + low
  wetland: number; // wet + low + flat
  cold: number; // snow/taiga affinity
}

/** Continuous terrain masks from the smooth fields. seaLevel = params.waterLevel. */
export function computeMasks(
  height: number,
  moisture: number,
  temperature: number,
  seaLevel: number,
): TerrainMasks {
  const landNorm = Math.max(0, Math.min(1, (height - seaLevel) / Math.max(0.01, 1 - seaLevel)));
  const mountain = smoothstep(0.44, 0.82, landNorm);
  const hill = smoothstep(0.14, 0.5, landNorm) * (1 - mountain);
  const lowland = Math.max(0, 1 - smoothstep(0.05, 0.4, landNorm));
  const dryHot = (1 - smoothstep(0.25, 0.42, moisture)) * smoothstep(0.5, 0.66, temperature);
  const desert = dryHot * lowland;
  const wetland =
    smoothstep(0.55, 0.78, moisture) * Math.max(0, 1 - smoothstep(0.0, 0.18, landNorm));
  const cold = 1 - smoothstep(0.28, 0.5, temperature);
  return { landNorm, mountain, hill, lowland, desert, wetland, cold };
}

/** Discrete per-biome descriptor for material + vegetation (not geometry). */
export interface BiomeProfile {
  /** Base albedo (linear RGB), before noise variation / slope / snow. */
  color: [number, number, number];
  /** Secondary tint blended in by world noise so biomes are not one flat colour. */
  colorAlt: [number, number, number];
  roughness: number;
  /** Vegetation affinity 0..1 (combined with the Stage 1 vegetation map). */
  vegetation: number;
}

const PROFILES: BiomeProfile[] = [];
const set = (b: Biome, p: BiomeProfile): void => {
  PROFILES[b] = p;
};

set(Biome.Ocean, {
  color: [0.05, 0.13, 0.28],
  colorAlt: [0.03, 0.08, 0.2],
  roughness: 0.7,
  vegetation: 0,
});
set(Biome.Coast, {
  color: [0.16, 0.34, 0.5],
  colorAlt: [0.1, 0.26, 0.42],
  roughness: 0.7,
  vegetation: 0,
});
set(Biome.Beach, {
  color: [0.82, 0.75, 0.55],
  colorAlt: [0.72, 0.64, 0.44],
  roughness: 0.95,
  vegetation: 0.05,
});
set(Biome.Grassland, {
  color: [0.42, 0.58, 0.28],
  colorAlt: [0.58, 0.62, 0.32],
  roughness: 0.95,
  vegetation: 0.5,
});
set(Biome.Forest, {
  color: [0.18, 0.36, 0.18],
  colorAlt: [0.26, 0.44, 0.22],
  roughness: 0.97,
  vegetation: 0.95,
});
set(Biome.Wetland, {
  color: [0.3, 0.4, 0.26],
  colorAlt: [0.22, 0.32, 0.2],
  roughness: 0.9,
  vegetation: 0.6,
});
set(Biome.Desert, {
  color: [0.8, 0.69, 0.42],
  colorAlt: [0.86, 0.76, 0.5],
  roughness: 0.96,
  vegetation: 0.05,
});
set(Biome.Hills, {
  color: [0.46, 0.52, 0.3],
  colorAlt: [0.55, 0.55, 0.34],
  roughness: 0.95,
  vegetation: 0.4,
});
set(Biome.RockyMountain, {
  color: [0.42, 0.4, 0.38],
  colorAlt: [0.52, 0.49, 0.45],
  roughness: 0.98,
  vegetation: 0.12,
});
set(Biome.SnowMountain, {
  color: [0.9, 0.92, 0.96],
  colorAlt: [0.78, 0.82, 0.9],
  roughness: 0.85,
  vegetation: 0.0,
});
set(Biome.Lake, {
  color: [0.13, 0.3, 0.55],
  colorAlt: [0.1, 0.24, 0.46],
  roughness: 0.4,
  vegetation: 0,
});
set(Biome.River, {
  color: [0.18, 0.4, 0.62],
  colorAlt: [0.14, 0.32, 0.54],
  roughness: 0.4,
  vegetation: 0,
});
set(Biome.Tundra, {
  color: [0.6, 0.62, 0.55],
  colorAlt: [0.66, 0.66, 0.6],
  roughness: 0.95,
  vegetation: 0.18,
});
set(Biome.Taiga, {
  color: [0.2, 0.34, 0.26],
  colorAlt: [0.26, 0.4, 0.28],
  roughness: 0.96,
  vegetation: 0.7,
});

const FALLBACK: BiomeProfile = {
  color: [0.5, 0.5, 0.5],
  colorAlt: [0.5, 0.5, 0.5],
  roughness: 0.95,
  vegetation: 0.2,
};

export function biomeProfile(b: Biome): BiomeProfile {
  return PROFILES[b] ?? FALLBACK;
}

export { smoothstep };
