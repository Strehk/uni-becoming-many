// ── SENSE MODULE: Duft — shared GPU uniforms + scent types ─────
//
// Ported from ChemischeWahrnemungExperiment `src/params.js`. The scent-type order is
// the index into the `typeIntensity` uniform array and into the emitter data.

import { instancedArray, uniform } from "three/tsl";

export interface ScentType {
  key: string;
  name: string;
  color: number;
  /** Default per-type intensity (the dev-console "Duft · <name>" slider). */
  intensity: number;
}

export const SCENT_TYPES: readonly ScentType[] = [
  { key: "blume", name: "Wiesenblume (blumig)", color: 0xff4f9a, intensity: 0.95 },
  { key: "lavendel", name: "Lavendel", color: 0x8a5cff, intensity: 1.0 },
  { key: "baum", name: "Laubbaum (honigartig)", color: 0xffb340, intensity: 1.05 },
  { key: "kiefer", name: "Kiefer (harzig)", color: 0x2fd6a3, intensity: 1.0 },
  { key: "kraut", name: "Kräuterbusch (frisch)", color: 0xb8e02e, intensity: 1.05 },
  { key: "pilz", name: "Pilz (erdig)", color: 0x8a6f4d, intensity: 1.05 },
  // Distinct scents/colours for the new authored flowers, so every flower species
  // reads as its own colour in the air (not one shared pink).
  { key: "rose", name: "Rose", color: 0xff2e5e, intensity: 1.0 },
  { key: "sonnenblume", name: "Sonnenblume", color: 0xffd21f, intensity: 1.0 },
  { key: "mohn", name: "Mohn", color: 0xff5a2e, intensity: 1.0 },
  { key: "glocke", name: "Glockenblume", color: 0x3aa0ff, intensity: 1.0 },
  { key: "klee", name: "Klee", color: 0x6ee06a, intensity: 1.0 },
  // Animal scent — the trail ground-fauna leave behind (see the animal trail).
  { key: "tier", name: "Tierfährte", color: 0xe86a3a, intensity: 1.0 },
];

const typeIntensityArr = new Float32Array(SCENT_TYPES.map((t) => t.intensity));
/** Live per-type RGB (0..1 ×3), indexed by scent type — the pickup pass reads this
 *  so type colours are adjustable at runtime (the panel writes via setTypeColor). */
const typeColorArr = new Float32Array(SCENT_TYPES.length * 3);
for (let i = 0; i < SCENT_TYPES.length; i++) {
  const hex = SCENT_TYPES[i]?.color ?? 0xffffff;
  typeColorArr[i * 3 + 0] = ((hex >> 16) & 0xff) / 255;
  typeColorArr[i * 3 + 1] = ((hex >> 8) & 0xff) / 255;
  typeColorArr[i * 3 + 2] = (hex & 0xff) / 255;
}

// Shared GPU uniforms — the sense UI writes into `.value` via `sense:param` commands.
// Defaults are the hand-tuned baseline (dev-console session, 2026-07).
export const u = {
  // Wind
  windSpeed: uniform(0.65),
  windDirRad: uniform(0.7),
  turbulence: uniform(1.6),
  noiseScale: uniform(0.28),
  noiseSpeed: uniform(0.3),
  rise: uniform(0.12),
  gust: uniform(0.25),
  gustFreq: uniform(0.25),
  spread: uniform(0.48),

  // Particles / scent
  size: uniform(0.14),
  intensity: uniform(1.5),
  pickup: uniform(8.3), // how fast air picks up scent
  evaporate: uniform(5.5), // evaporation (seconds)
  spawnRadius: uniform(0.9), // multiplier on the scent-zone radii
  airOpacity: uniform(0.0), // make unscented air visible
  airHeight: uniform(12.0), // height of the air layer above ground (m) — covers tree crowns
  airGround: uniform(6.0), // ground-affinity exponent (1 = uniform, higher = low)

  // Simulation
  timeScale: uniform(1.0),
  windOnly: uniform(0.0), // 1 = show only the wind field (neutral, no scent)
  /** Scaled frame delta, written from the clock spine each frame (replaces TSL
   *  `deltaTime` so the field pauses/seeks with the piece). */
  delta: uniform(0.0),
  /** Seconds on the time spine (replaces TSL `time` inside the compute). */
  time: uniform(0.0),
  /** Sense-layer fade 0..1 (eased from `signals.sense.duft`); multiplies opacity. */
  fade: uniform(0.0),

  // Performance
  pickupStride: uniform(1.0), // scent pickup only every Nth frame (compensated)
  frameMod: uniform(0.0), // current frame % pickupStride (set by the loop)
  cheapNoise: uniform(0.0), // 1 = cheap turbulence (1 noise channel instead of 3)
  cullDist: uniform(115.0), // don't rasterize particles beyond this distance

  // ── Animal scent trail (ground fauna leave a fading scent that collects low) ──
  animalTrail: uniform(1.0), // strength multiplier on the trail scent (0 = off)
  animalTrailLife: uniform(9.0), // seconds a dropped trail mark lingers before it fades out
  animalTrailRadius: uniform(2.2), // radius of each trail scent mark (m)
  animalTrailHeight: uniform(0.35), // how high above the ground the trail sits (m — "am Boden")
  animalTrailInterval: uniform(0.4), // seconds between drops along an animal's path

  // Intensity per scent type (index = SCENT_TYPES); a small storage buffer so the
  // compute pass can index it (uniformArray element nodes are too loosely typed).
  typeIntensity: instancedArray(typeIntensityArr, "float"),
  // Live RGB per scent type (index = SCENT_TYPES) — the pickup pass colours air
  // from this, so type colours can be tuned at runtime.
  typeColor: instancedArray(typeColorArr, "vec3"),
};

/** Write one scent type's intensity (mirrors into the GPU buffer). */
export function setTypeIntensity(index: number, value: number): void {
  if (index >= 0 && index < typeIntensityArr.length) {
    typeIntensityArr[index] = value;
    u.typeIntensity.value.needsUpdate = true;
  }
}

/** Read one scent type's intensity. */
export function getTypeIntensity(index: number): number {
  return typeIntensityArr[index] ?? 1;
}

/** Write one scent type's colour from a hex string (mirrors into the GPU buffer). */
export function setTypeColor(index: number, hex: string): void {
  if (index < 0 || index >= SCENT_TYPES.length) return;
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return;
  typeColorArr[index * 3 + 0] = ((n >> 16) & 0xff) / 255;
  typeColorArr[index * 3 + 1] = ((n >> 8) & 0xff) / 255;
  typeColorArr[index * 3 + 2] = (n & 0xff) / 255;
  u.typeColor.value.needsUpdate = true;
}

/** Read one scent type's colour as a hex string (for the dev-panel bindings). */
export function getTypeColor(index: number): string {
  const r = Math.round((typeColorArr[index * 3 + 0] ?? 1) * 255);
  const g = Math.round((typeColorArr[index * 3 + 1] ?? 1) * 255);
  const b = Math.round((typeColorArr[index * 3 + 2] ?? 1) * 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
