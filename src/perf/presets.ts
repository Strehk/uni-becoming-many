// ── Becoming Many — Quality presets ──────────────────────────────
//
// The four quality steps, as one table shared by both UIs that offer them: the
// C-console Performance panel (where they sit above the individual sliders) and
// the audience Einstellungen screen (where they are the *only* quality control).
// Keeping the table here — rather than inside either panel — is what lets the two
// stay in sync; the routing that turns these ids into live world writes lives in
// src/perf/router.ts.
//
// "Hoch" mirrors the committed tuning from the perf audit; Niedrig/Mittel scale
// down for weaker exhibition machines and phones, Ultra opens the full pixel ratio
// and the longest trails on strong GPUs.

export type Preset = {
  id: string;
  label: string;
  /** One line for the audience menu — what this step trades away. */
  note: string;
  /** Duft cheap-turbulence toggle (~3× cheaper GPU sim). */
  cheapNoise: boolean;
  values: Record<string, number>;
};

export const PRESETS: Preset[] = [
  {
    id: "niedrig",
    label: "Niedrig",
    note: "Für Handys und schwache Rechner",
    cheapNoise: true,
    values: {
      renderScale: 0.75,
      grassRadius: 16,
      grassKeepFraction: 0.3,
      streamBuildRadius: 1,
      floraViewDistance: 300,
      "flora.globalDensity": 0.5,
      "flora.treeDensity": 0.4,
      "fauna.mosquitoSwarmCount": 4,
      "fauna.flockCount": 3,
      "fauna.deerCount": 3,
      "fauna.foxCount": 4,
      "fauna.batFlockCount": 2,
      "fauna.meiseFlockCount": 3,
      "fauna.butterflyFlockCount": 5,
      "duft.count": 60000,
      "rundum.cubeSize": 256,
      "rundum.captureInterval": 3,
      "motion.lifetimeFrames": 6,
    },
  },
  {
    id: "mittel",
    label: "Mittel",
    note: "Ausgewogen — gute Laptops, starke Handys",
    cheapNoise: true,
    values: {
      renderScale: 1,
      grassRadius: 28,
      grassKeepFraction: 0.6,
      streamBuildRadius: 2,
      floraViewDistance: 420,
      "flora.globalDensity": 0.8,
      "flora.treeDensity": 0.7,
      "fauna.mosquitoSwarmCount": 8,
      "fauna.flockCount": 5,
      "fauna.deerCount": 8,
      "fauna.foxCount": 6,
      "fauna.batFlockCount": 4,
      "fauna.meiseFlockCount": 4,
      "fauna.butterflyFlockCount": 7,
      "duft.count": 150000,
      "rundum.cubeSize": 512,
      "rundum.captureInterval": 2,
      "motion.lifetimeFrames": 10,
    },
  },
  {
    id: "hoch",
    label: "Hoch",
    note: "Die Ausstellungs-Einstellung",
    cheapNoise: false,
    values: {
      renderScale: 1.5,
      grassRadius: 48,
      grassKeepFraction: 1,
      streamBuildRadius: 2,
      floraViewDistance: 640,
      "flora.globalDensity": 1,
      "flora.treeDensity": 1,
      "fauna.mosquitoSwarmCount": 17,
      "fauna.flockCount": 8,
      "fauna.deerCount": 18,
      "fauna.foxCount": 11,
      "fauna.batFlockCount": 6,
      "fauna.meiseFlockCount": 6,
      "fauna.butterflyFlockCount": 9,
      "duft.count": 400000,
      "rundum.cubeSize": 1024,
      "rundum.captureInterval": 2,
      "motion.lifetimeFrames": 14,
    },
  },
  {
    id: "ultra",
    label: "Ultra",
    note: "Volle Auflösung — nur für starke Grafikkarten",
    cheapNoise: false,
    values: {
      renderScale: 2,
      grassRadius: 48,
      grassKeepFraction: 1,
      streamBuildRadius: 2,
      floraViewDistance: 896,
      "flora.globalDensity": 1,
      "flora.treeDensity": 1,
      "fauna.mosquitoSwarmCount": 17,
      "fauna.flockCount": 8,
      "fauna.deerCount": 18,
      "fauna.foxCount": 11,
      "fauna.batFlockCount": 6,
      "fauna.meiseFlockCount": 6,
      "fauna.butterflyFlockCount": 9,
      "duft.count": 400000,
      "rundum.cubeSize": 1024,
      "rundum.captureInterval": 1,
      "motion.lifetimeFrames": 20,
    },
  },
];

/** The preset with this id, or undefined for "eigene" / an unknown saved value. */
export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
