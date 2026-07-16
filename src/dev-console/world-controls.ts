// ── Becoming Many — World Controls (dev GUI) ───────────────────
//
// A live terrain-tuning panel mounted inside the C dev console (via
// `devConsole.addSection`). Exposes every world knob as a slider:
//
//   • Provider  — swap the terrain algorithm (worldgen / ridged / sine-hills).
//   • Base      — the flat TerrainConfig (seed / amplitude / frequency / octaves),
//                 pushed through `world.setConfig`. Always applies.
//   • GenParams — the ~50 worldgen knobs (height, climate, rivers, lakes, surface,
//                 structure, 3D detail, view), pushed through `world.setParams`.
//                 These overlay the worldgen generator only; with a pointwise
//                 provider active they are greyed out.
//
// Slider edits are debounced (a world rebuild clears + re-streams every chunk, so
// we coalesce a drag into one rebuild) while the numeric read-out updates live.
// Fully removable via the returned `dispose()`.

import { WORLDGEN_PARAMS } from "../terrain/gen/params.ts";
import type { TerrainWorld } from "../terrain/index.ts";
import { listTerrainProviders } from "../terrain/providers/index.ts";

const STYLE_ID = "devc-world-styles";
const FLUSH_MS = 160; // coalesce a slider drag into one world rebuild

export interface WorldControls {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  /** Stop timers and detach the DOM. */
  dispose(): void;
}

type SliderSpec = { key: string; label: string; min: number; max: number; step: number };
type Group = {
  title: string;
  target: "config" | "params";
  open?: boolean;
  sliders: SliderSpec[];
};

// The flat TerrainConfig knobs (→ world.setConfig). amplitude/frequency map onto
// terrainHeightScale/continentScale; octaves drives the pointwise providers.
const BASE_GROUP: Group = {
  title: "Base",
  target: "config",
  open: true,
  sliders: [
    { key: "amplitude", label: "Amplitude", min: 0, max: 3, step: 0.05 },
    { key: "frequency", label: "Frequency", min: 0.1, max: 4, step: 0.05 },
    { key: "octaves", label: "Octaves", min: 1, max: 8, step: 1 },
  ],
};

// The rich worldgen knobs (→ world.setParams). Defaults are read live from
// WORLDGEN_PARAMS, so the slider start position matches the generator.
const PARAM_GROUPS: Group[] = [
  {
    title: "Height",
    target: "params",
    open: true,
    sliders: [
      { key: "waterLevel", label: "Water level", min: 0, max: 1, step: 0.01 },
      { key: "continentScale", label: "Continent scale", min: 200, max: 2500, step: 25 },
      { key: "heightScale", label: "Height contrast", min: 0, max: 2, step: 0.05 },
      { key: "noiseScale", label: "Noise scale", min: 20, max: 500, step: 5 },
      { key: "domainWarpStrength", label: "Domain warp", min: 0, max: 1, step: 0.01 },
      { key: "mountainStrength", label: "Mountain strength", min: 0, max: 2, step: 0.05 },
      { key: "ridgeStrength", label: "Ridge strength", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Climate",
    target: "params",
    sliders: [
      { key: "temperatureGradient", label: "Temp. gradient", min: 0, max: 1, step: 0.01 },
      { key: "moistureScale", label: "Moisture scale", min: 100, max: 2000, step: 25 },
      { key: "biomeScale", label: "Biome scale", min: 0.2, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Biome Frequency",
    target: "params",
    open: true,
    sliders: [
      {
        key: "biomeOceanFrequency",
        label: "Ozeane · Häufigkeit",
        min: 0,
        max: 3,
        step: 0.05,
      },
      { key: "biomeOceanSize", label: "Ozeane · Größe", min: 0.1, max: 2, step: 0.05 },
      { key: "biomeCoastFrequency", label: "Coast", min: 0, max: 3, step: 0.05 },
      { key: "biomeBeachFrequency", label: "Beach", min: 0, max: 3, step: 0.05 },
      { key: "biomeGrasslandFrequency", label: "Grassland", min: 0, max: 3, step: 0.05 },
      { key: "biomeForestFrequency", label: "Forest", min: 0, max: 3, step: 0.05 },
      { key: "biomeWetlandFrequency", label: "Wetland", min: 0, max: 3, step: 0.05 },
      { key: "biomeDesertFrequency", label: "Desert", min: 0, max: 3, step: 0.05 },
      { key: "biomeHillsFrequency", label: "Hills", min: 0, max: 3, step: 0.05 },
      {
        key: "biomeRockyMountainFrequency",
        label: "Rocky Mountain",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        key: "biomeSnowMountainFrequency",
        label: "Snow Mountain",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        key: "biomeLakeFrequency",
        label: "Seen · Häufigkeit",
        min: 0,
        max: 3,
        step: 0.05,
      },
      { key: "biomeLakeSize", label: "Seen · Größe", min: 0.1, max: 2, step: 0.05 },
      { key: "biomeRiverFrequency", label: "River", min: 0, max: 3, step: 0.05 },
      { key: "biomeTundraFrequency", label: "Tundra", min: 0, max: 3, step: 0.05 },
      { key: "biomeTaigaFrequency", label: "Taiga", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Rivers",
    target: "params",
    sliders: [
      { key: "riverSourceCount", label: "Source count", min: 0, max: 40, step: 1 },
      { key: "riverDensity", label: "Density", min: 0, max: 3, step: 0.05 },
      { key: "riverMeanderStrength", label: "Meander", min: 0, max: 1, step: 0.01 },
      { key: "riverCarvingStrength", label: "Carving", min: 0, max: 1, step: 0.01 },
      { key: "riverWidthMultiplier", label: "Width ×", min: 0.2, max: 3, step: 0.05 },
      { key: "riverSourceBias", label: "Source bias", min: 0, max: 1, step: 0.01 },
      { key: "riverMaxHeight", label: "Max height", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Lakes",
    target: "params",
    sliders: [
      { key: "lakeFrequency", label: "Frequency", min: 0, max: 1, step: 0.01 },
      { key: "lakeSpillTolerance", label: "Spill tolerance", min: 0, max: 0.2, step: 0.005 },
      { key: "lakeMaxHeight", label: "Max height", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Surface",
    target: "params",
    sliders: [
      { key: "shoreWidth", label: "Shore width", min: 0, max: 2, step: 0.05 },
      { key: "vegetationDensity", label: "Vegetation", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Structure (WFC)",
    target: "params",
    sliders: [
      { key: "macroResolution", label: "Macro res", min: 16, max: 64, step: 16 },
      { key: "macroCellSize", label: "Macro cell", min: 8, max: 64, step: 8 },
      { key: "heightWfcStrength", label: "Landform mix", min: 0, max: 1, step: 0.01 },
      { key: "mesoSubdiv", label: "Meso subdiv", min: 1, max: 4, step: 1 },
    ],
  },
  {
    title: "3D Detail",
    target: "params",
    sliders: [
      { key: "reliefExponent", label: "Relief exponent", min: 0.5, max: 4, step: 0.1 },
      { key: "detailStrength", label: "Detail strength", min: 0, max: 3, step: 0.05 },
      { key: "mountainRidgeStrength", label: "Mtn ridge", min: 0, max: 3, step: 0.05 },
      { key: "cliffStrength", label: "Cliff strength", min: 0, max: 3, step: 0.05 },
      { key: "riverValleyStrength", label: "River valley", min: 0, max: 3, step: 0.05 },
      { key: "riverWaterOffset", label: "River water Δ", min: 0, max: 3, step: 0.05 },
      { key: "lakeWaterOffset", label: "Lake water Δ", min: -2, max: 2, step: 0.05 },
      { key: "shoreSmoothing", label: "Shore smoothing", min: 0, max: 3, step: 0.05 },
      { key: "snowHeight", label: "Snow height", min: 0, max: 1, step: 0.01 },
      { key: "snowSoftness", label: "Snow softness", min: 0, max: 0.5, step: 0.01 },
      { key: "rockSlopeThreshold", label: "Rock slope", min: 0, max: 1, step: 0.01 },
      { key: "treeDensity", label: "Tree density", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: "3D View / Render",
    target: "params",
    sliders: [
      { key: "terrainHeightScale", label: "Vertical scale", min: 10, max: 400, step: 5 },
      { key: "meshResolution", label: "Mesh res", min: 16, max: 128, step: 1 },
      { key: "streamRadius", label: "Stream radius", min: 1, max: 8, step: 1 },
      { key: "sunAzimuth", label: "Sun azimuth", min: 0, max: 360, step: 1 },
      { key: "sunElevation", label: "Sun elevation", min: 0, max: 90, step: 1 },
      { key: "sunIntensity", label: "Sun intensity", min: 0, max: 5, step: 0.1 },
      { key: "fogDistance", label: "Fog distance", min: 200, max: 6000, step: 50 },
      { key: "flySpeed", label: "Fly speed", min: 0, max: 500, step: 5 },
    ],
  },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const decimals = (step: number): number =>
  step >= 1 ? 0 : (String(step).split(".")[1]?.length ?? 2);
const fmt = (v: number, step: number): string => v.toFixed(decimals(step));

/** Read a slider's start value from the world's live state: config knobs from
 *  `world.config`, worldgen knobs from any live override (e.g. a loaded state.json)
 *  falling back to the base params. Clamped into the slider's range. */
function defaultFor(world: TerrainWorld, group: Group, spec: SliderSpec): number {
  const raw =
    group.target === "config"
      ? ((world.config as unknown as Record<string, number>)[spec.key] ?? 0)
      : (world.paramOverrides[spec.key] ??
        (WORLDGEN_PARAMS as unknown as Record<string, number>)[spec.key] ??
        0);
  return clamp(raw, spec.min, spec.max);
}

/** The worldgen knob's canonical (code) default, used by Reset to clear any override. */
function canonicalParamDefault(spec: SliderSpec): number {
  const raw = (WORLDGEN_PARAMS as unknown as Record<string, number>)[spec.key] ?? spec.min;
  return clamp(raw, spec.min, spec.max);
}

/**
 * Build the world-controls panel bound to `world`. Returns the section element
 * (mount via `devConsole.addSection`) plus a `dispose`.
 */
export function createWorldControls(world: TerrainWorld): WorldControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section wc-root";

  // --- Debounced flush: coalesce drags into one rebuild ----------------------
  let pendingConfig: Record<string, number> = {};
  let pendingParams: Record<string, number> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (Object.keys(pendingConfig).length > 0) {
      world.setConfig(pendingConfig);
      pendingConfig = {};
    }
    if (Object.keys(pendingParams).length > 0) {
      world.setParams(pendingParams);
      pendingParams = {};
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_MS);
  };
  const queue = (target: Group["target"], key: string, value: number): void => {
    if (target === "config") pendingConfig[key] = value;
    else pendingParams[key] = value;
    schedule();
  };

  // --- Header ----------------------------------------------------------------
  const head = document.createElement("div");
  head.className = "wc-head";
  head.innerHTML = '<h3 class="devc-h3">World</h3>';
  const resetBtn = document.createElement("button");
  resetBtn.className = "wc-reset";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Restore defaults";
  head.append(resetBtn);
  root.append(head);

  // --- Provider selector -----------------------------------------------------
  const provRow = document.createElement("label");
  provRow.className = "wc-prov";
  provRow.innerHTML = "<span>Provider</span>";
  const provSelect = document.createElement("select");
  for (const p of listTerrainProviders()) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label ?? p.id;
    provSelect.append(opt);
  }
  provSelect.value = world.providerId;
  provRow.append(provSelect);
  root.append(provRow);

  // Track slider elements so Reset can restore them and provider changes can
  // enable/disable the worldgen-only groups.
  const sliderControls: Array<{
    group: Group;
    spec: SliderSpec;
    input: HTMLInputElement;
    valueEl: HTMLElement;
    fieldset: HTMLElement;
  }> = [];
  const paramFieldsets: HTMLElement[] = [];

  // --- Seed (special: number + randomize) ------------------------------------
  const seedRow = document.createElement("div");
  seedRow.className = "wc-seed";
  seedRow.innerHTML = "<span>Seed</span>";
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.min = "0";
  seedInput.step = "1";
  seedInput.value = String(world.config.seed);
  const seedDice = document.createElement("button");
  seedDice.className = "wc-dice";
  seedDice.textContent = "🎲";
  seedDice.title = "Randomize seed";
  seedRow.append(seedInput, seedDice);
  root.append(seedRow);

  const applySeed = (seed: number): void => {
    seedInput.value = String(seed);
    world.setConfig({ seed: seed >>> 0 });
  };
  seedInput.addEventListener("change", () => {
    const v = Number.parseInt(seedInput.value, 10);
    if (Number.isFinite(v)) applySeed(v);
  });
  seedDice.addEventListener("click", () => {
    applySeed(Math.floor(Math.random() * 0xffffffff));
  });

  // --- Slider groups ---------------------------------------------------------
  const buildGroup = (group: Group): HTMLElement => {
    const details = document.createElement("details");
    details.className = "wc-group";
    if (group.open) details.open = true;
    if (group.target === "params") paramFieldsets.push(details);

    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.append(summary);

    for (const spec of group.sliders) {
      const row = document.createElement("div");
      row.className = "wc-row";

      const labelEl = document.createElement("label");
      labelEl.className = "wc-label";
      labelEl.textContent = spec.label;

      const valueEl = document.createElement("b");
      valueEl.className = "wc-val";

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      const def = defaultFor(world, group, spec);
      input.value = String(def);
      valueEl.textContent = fmt(def, spec.step);

      input.addEventListener("input", () => {
        const v = Number.parseFloat(input.value);
        valueEl.textContent = fmt(v, spec.step);
        queue(group.target, spec.key, v);
      });
      // Commit immediately on release so a rebuild isn't left waiting.
      input.addEventListener("change", flush);

      row.append(labelEl, valueEl, input);
      details.append(row);
      sliderControls.push({ group, spec, input, valueEl, fieldset: details });
    }
    return details;
  };

  for (const g of [BASE_GROUP, ...PARAM_GROUPS]) {
    root.append(buildGroup(g));
  }

  // --- Provider enable/disable ------------------------------------------------
  // The GenParams overlay only reaches the worldgen ("chunk") generator; grey the
  // param groups out when a pointwise provider is active so it's clear they're inert.
  const note = document.createElement("p");
  note.className = "wc-note";
  root.append(note);

  const refreshProviderState = (): void => {
    const isWorldgen = provSelect.value === "worldgen";
    for (const fs of paramFieldsets) {
      fs.classList.toggle("wc-disabled", !isWorldgen);
    }
    note.textContent = isWorldgen ? "" : "GenParams apply to the worldgen provider only.";
    note.style.display = isWorldgen ? "none" : "";
  };
  refreshProviderState();

  provSelect.addEventListener("change", () => {
    world.setProvider(provSelect.value);
    refreshProviderState();
  });

  // --- Reset -----------------------------------------------------------------
  resetBtn.addEventListener("click", () => {
    clearTimeout(timer);
    pendingConfig = {};
    pendingParams = {};
    for (const { group, spec, input, valueEl } of sliderControls) {
      // Reset to canonical code defaults, not the live values — `defaultFor` now
      // reflects any loaded override, which is exactly what Reset must clear.
      const start =
        group.target === "config" ? canonicalConfigDefault(spec) : canonicalParamDefault(spec);
      input.value = String(start);
      valueEl.textContent = fmt(start, spec.step);
    }
    const seed = world.config.seed;
    seedInput.value = String(seed);
    world.resetParams();
    world.setConfig(canonicalConfig());
  });

  return {
    element: root,
    dispose(): void {
      clearTimeout(timer);
      root.remove();
    },
  };
}

/** The worldgen provider's canonical flat defaults, used by Reset. */
function canonicalConfig(): { amplitude: number; frequency: number; octaves: number } {
  return { amplitude: 1, frequency: 1, octaves: 4 };
}
function canonicalConfigDefault(spec: SliderSpec): number {
  return (canonicalConfig() as unknown as Record<string, number>)[spec.key] ?? spec.min;
}

// --- Styles (injected once) --------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.wc-root { display: flex; flex-direction: column; gap: 8px; }
.wc-head { display: flex; align-items: center; justify-content: space-between; }
.wc-head .devc-h3 { margin: 0; }
.wc-reset {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 10px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; text-transform: uppercase; letter-spacing: 0.05em;
}
.wc-reset:hover { color: #38bdf8; border-color: #38bdf8; }

.wc-prov, .wc-seed { display: flex; align-items: center; gap: 8px; }
.wc-prov > span, .wc-seed > span {
  font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; width: 58px;
}
.wc-prov select, .wc-seed input {
  flex: 1; min-width: 0; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 3px; color: #e6e6e6;
  font-family: inherit; font-size: 12px; padding: 3px 6px;
}
.wc-dice {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; cursor: pointer; padding: 2px 6px; font-size: 12px;
}
.wc-dice:hover { border-color: #38bdf8; }

.wc-group { border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 8px 8px; }
.wc-group[open] { padding-bottom: 10px; }
.wc-group > summary {
  cursor: pointer; list-style: none; padding: 6px 0; font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: #a1a1aa; user-select: none;
}
.wc-group > summary::-webkit-details-marker { display: none; }
.wc-group > summary::before { content: "▸ "; color: #52525b; }
.wc-group[open] > summary::before { content: "▾ "; }
.wc-group.wc-disabled { opacity: 0.4; pointer-events: none; }

.wc-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; margin: 6px 0; }
.wc-label { font-size: 11px; color: #a1a1aa; }
.wc-val { font-size: 11px; color: #38bdf8; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.wc-row input[type="range"] { grid-column: 1 / -1; width: 100%; height: 16px; accent-color: #38bdf8; cursor: pointer; }

.wc-note { margin: 0; font-size: 10px; color: #facc15; }
`;
