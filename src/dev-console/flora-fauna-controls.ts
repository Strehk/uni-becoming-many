// ── Becoming Many — Flora & Fauna Controls (dev GUI) ───────────
//
// A live tuning panel mounted inside the C dev console (via `devConsole.addSection`),
// sitting beside the World panel it mirrors in style. Every widget emits a
// `flora-fauna:param {key, value}` bus command — the exact channel the state loader
// replays — and the coordinator (src/flora-fauna) applies it (density → re-scatter,
// counts → flock/mushroom rebuild), debounced.
//
// Widgets by shape (not everything is a slider): continuous multipliers are RANGE
// sliders; standalone spawn COUNTS (flocks, mushrooms, per-species caps) are
// editable NUMBER fields. Per-swarm animal ranges use paired integer sliders.

import { DEFAULT_CONFIG, type FloraFaunaConfig } from "../flora-fauna/config.ts";
import { SPECIES, SPECIES_IDS } from "../life/species.ts";
import type { Bus } from "../signals/index.ts";

const STYLE_ID = "devc-flora-fauna-styles";

export interface FloraFaunaControls {
  readonly element: HTMLElement;
  dispose(): void;
}

type Spec =
  | { kind: "slider"; key: string; label: string; min: number; max: number; step: number }
  | { kind: "count"; key: string; label: string; min: number; max: number; step: number }
  | { kind: "number"; key: string; label: string; min: number; max: number; step: number };
type Group = { title: string; open?: boolean; specs: Spec[] };

const GROUPS: Group[] = [
  {
    title: "Flora · Dichte",
    open: true,
    specs: [
      { kind: "slider", key: "flora.globalDensity", label: "Gesamt", min: 0, max: 2, step: 0.05 },
      { kind: "slider", key: "flora.treeDensity", label: "Bäume", min: 0, max: 2, step: 0.05 },
      {
        kind: "slider",
        key: "flora.undergrowthDensity",
        label: "Unterholz",
        min: 0,
        max: 2,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "flora.flowerDensity",
        label: "Blumen & Gräser",
        min: 0,
        max: 2,
        step: 0.05,
      },
      { kind: "slider", key: "flora.mushroomDensity", label: "Pilze", min: 0, max: 2, step: 0.05 },
      { kind: "slider", key: "flora.rockDensity", label: "Steine", min: 0, max: 2, step: 0.05 },
      {
        kind: "slider",
        key: "flora.deadwoodDensity",
        label: "Totholz & Äste",
        min: 0,
        max: 2,
        step: 0.05,
      },
    ],
  },
  {
    title: "Wald · Zusammensetzung",
    open: true,
    specs: [
      {
        kind: "slider",
        key: "flora.nadelAnteil",
        label: "Nadelwald-Anteil",
        min: 0,
        max: 1,
        step: 0.02,
      },
      {
        kind: "slider",
        key: "flora.mischBreite",
        label: "Mischwald-Breite",
        min: 0.02,
        max: 0.6,
        step: 0.02,
      },
      {
        kind: "slider",
        key: "flora.forestClearing",
        label: "Lichtungen",
        min: 0,
        max: 1,
        step: 0.02,
      },
      {
        kind: "slider",
        key: "flora.forestZoneScale",
        label: "Waldzonen-Größe",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Bäume · Größe",
    open: false,
    specs: [
      {
        kind: "slider",
        key: "flora.treeScale",
        label: "Baumgröße ×",
        min: 0.5,
        max: 1.6,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "flora.treeScaleVariance",
        label: "Größen-Streuung ×",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "flora.youngTrees",
        label: "Kleine Bäume (Anteil)",
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: "Wiesen & Lichtungen",
    open: false,
    specs: [
      {
        kind: "slider",
        key: "flora.flowerMeadow",
        label: "Blumen auf Wiesen ×",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "flora.bushMeadow",
        label: "Büsche auf Wiesen ×",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "flora.flowerClearing",
        label: "Blüte auf Lichtungen ×",
        min: 0,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    // Clumped spawning: Stärke pulls the category into clumps, Größe is the
    // clump wavelength in metres (a number field — type any size).
    title: "Gruppierung",
    open: false,
    specs: [
      {
        kind: "slider",
        key: "flora.bushCluster",
        label: "Büsche · Stärke",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: "number",
        key: "flora.bushClusterSize",
        label: "Büsche · Gruppengröße (m)",
        min: 4,
        max: 120,
        step: 1,
      },
      {
        kind: "slider",
        key: "flora.flowerCluster",
        label: "Blumen · Stärke",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: "number",
        key: "flora.flowerClusterSize",
        label: "Blumen · Gruppengröße (m)",
        min: 4,
        max: 120,
        step: 1,
      },
      {
        kind: "slider",
        key: "flora.mushroomCluster",
        label: "Pilze · Stärke",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: "number",
        key: "flora.mushroomClusterSize",
        label: "Pilze · Gruppengröße (m)",
        min: 4,
        max: 120,
        step: 1,
      },
    ],
  },
  {
    title: "Steine",
    open: false,
    specs: [
      {
        kind: "slider",
        key: "flora.rockSlopeBias",
        label: "Hang-Vorliebe",
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: "Gras",
    open: false,
    specs: [
      { kind: "slider", key: "flora.grassHeight", label: "Höhe ×", min: 0.2, max: 3, step: 0.05 },
      { kind: "slider", key: "flora.grassMeadow", label: "Wiese ×", min: 0, max: 2, step: 0.05 },
      { kind: "slider", key: "flora.grassForest", label: "Wald ×", min: 0, max: 3, step: 0.05 },
      { kind: "slider", key: "flora.grassTaiga", label: "Taiga ×", min: 0, max: 3, step: 0.05 },
      { kind: "slider", key: "flora.grassHills", label: "Hügel ×", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Wind",
    open: false,
    specs: [
      {
        kind: "slider",
        key: "flora.swayStrength",
        label: "Wind (Sway)",
        min: 0,
        max: 2,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Vögel",
    open: true,
    specs: [
      { kind: "count", key: "fauna.flockCount", label: "Schwärme", min: 1, max: 48, step: 1 },
      {
        kind: "count",
        key: "fauna.birdMinPerFlock",
        label: "Vögel / Schwarm · Min",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.birdMaxPerFlock",
        label: "Vögel / Schwarm · Max",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "slider",
        key: "fauna.roamScale",
        label: "Streifradius ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "fauna.flightSpeed",
        label: "Fluggeschw. ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Fledermäuse",
    open: true,
    specs: [
      {
        kind: "count",
        key: "fauna.batFlockCount",
        label: "Schwärme",
        min: 1,
        max: 48,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.batMinPerFlock",
        label: "Fledermäuse / Schwarm · Min",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.batMaxPerFlock",
        label: "Fledermäuse / Schwarm · Max",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "slider",
        key: "fauna.batRoamScale",
        label: "Streifradius ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "fauna.batFlightSpeed",
        label: "Fluggeschw. ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Meisen",
    open: true,
    specs: [
      {
        kind: "count",
        key: "fauna.meiseFlockCount",
        label: "Schwärme · Anzahl",
        min: 0,
        max: 48,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.meiseMinPerFlock",
        label: "Meisen / Schwarm · Min",
        min: 1,
        max: 120,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.meiseMaxPerFlock",
        label: "Meisen / Schwarm · Max",
        min: 1,
        max: 120,
        step: 1,
      },
      {
        kind: "slider",
        key: "fauna.meiseRoamScale",
        label: "Streifradius ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "fauna.meiseFlightSpeed",
        label: "Fluggeschw. ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Schmetterlinge",
    open: true,
    specs: [
      {
        kind: "count",
        key: "fauna.butterflyFlockCount",
        label: "Gruppen · Anzahl",
        min: 0,
        max: 80,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.butterflyMinPerFlock",
        label: "Falter / Gruppe · Min",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.butterflyMaxPerFlock",
        label: "Falter / Gruppe · Max",
        min: 1,
        max: 80,
        step: 1,
      },
      {
        kind: "slider",
        key: "fauna.butterflyRoamScale",
        label: "Streifradius ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "fauna.butterflyFlightSpeed",
        label: "Fluggeschw. ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Mücken",
    open: true,
    specs: [
      {
        kind: "count",
        key: "fauna.mosquitoSwarmCount",
        label: "Schwärme",
        min: 0,
        max: 48,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.mosquitoMinPerSwarm",
        label: "Mücken / Schwarm · Min",
        min: 1,
        max: 400,
        step: 1,
      },
      {
        kind: "count",
        key: "fauna.mosquitoMaxPerSwarm",
        label: "Mücken / Schwarm · Max",
        min: 1,
        max: 400,
        step: 1,
      },
      {
        kind: "slider",
        key: "fauna.mosquitoSpread",
        label: "Schwarmradius ×",
        min: 0.3,
        max: 2,
        step: 0.05,
      },
      {
        kind: "slider",
        key: "fauna.mosquitoFlightSpeed",
        label: "Surrgeschw. ×",
        min: 0.3,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    title: "Fauna · Pilze",
    open: true,
    specs: [
      { kind: "count", key: "fauna.mushroomCount", label: "Anzahl", min: 0, max: 480, step: 1 },
      {
        kind: "slider",
        key: "fauna.mushroomRadius",
        label: "Streuradius (m)",
        min: 20,
        max: 300,
        step: 5,
      },
    ],
  },
  {
    title: "Fauna · Hirsch",
    open: true,
    specs: [
      { kind: "count", key: "fauna.deerCount", label: "Anzahl", min: 0, max: 64, step: 1 },
      { kind: "slider", key: "fauna.deerScale", label: "Größe ×", min: 0.4, max: 2, step: 0.05 },
      { kind: "slider", key: "fauna.deerSpeed", label: "Tempo (m/s)", min: 0.3, max: 3, step: 0.1 },
      {
        kind: "slider",
        key: "fauna.deerRoamRadius",
        label: "Streifradius (m)",
        min: 30,
        max: 260,
        step: 5,
      },
      {
        kind: "slider",
        key: "fauna.deerTreeClearance",
        label: "Baumabstand (m)",
        min: 1,
        max: 10,
        step: 0.25,
      },
    ],
  },
  {
    title: "Fauna · Fuchs",
    open: true,
    specs: [
      { kind: "count", key: "fauna.foxCount", label: "Anzahl", min: 0, max: 96, step: 1 },
      { kind: "slider", key: "fauna.foxScale", label: "Größe ×", min: 0.01, max: 2, step: 0.01 },
      { kind: "slider", key: "fauna.foxSpeed", label: "Tempo (m/s)", min: 0.3, max: 4, step: 0.1 },
      {
        kind: "slider",
        key: "fauna.foxRoamRadius",
        label: "Streifradius (m)",
        min: 20,
        max: 200,
        step: 5,
      },
      {
        kind: "slider",
        key: "fauna.foxTreeClearance",
        label: "Baumabstand (m)",
        min: 0.5,
        max: 6,
        step: 0.25,
      },
    ],
  },
  {
    // Advanced: absolute per-species cap overrides — bypass the category maths.
    title: "Erweitert · pro Art",
    open: false,
    specs: SPECIES_IDS.map((id) => ({
      kind: "number" as const,
      key: `flora.speciesCap.${id}`,
      label: id,
      min: 0,
      max: SPECIES[id].perChunkCap * 2,
      step: 1,
    })),
  },
];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const decimals = (step: number): number =>
  step >= 1 ? 0 : (String(step).split(".")[1]?.length ?? 2);
const fmt = (v: number, step: number): string => v.toFixed(decimals(step));

/** Read a dotted key's start value from the live config; per-species advanced
 *  caps fall back to the base cap (what's currently placed) when unset. */
function startValue(config: FloraFaunaConfig, key: string): number {
  if (key.startsWith("flora.speciesCap.")) {
    const id = key.slice("flora.speciesCap.".length) as keyof typeof SPECIES;
    return config.flora.speciesCap[id] ?? SPECIES[id].perChunkCap;
  }
  const [domain, field] = key.split(".");
  const src =
    domain === "flora"
      ? (config.flora as unknown as Record<string, number>)
      : (config.fauna as unknown as Record<string, number>);
  return src[field ?? ""] ?? 0;
}

export function createFloraFaunaControls(bus: Bus, config: FloraFaunaConfig): FloraFaunaControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section ff-root";

  const head = document.createElement("div");
  head.className = "ff-head";
  head.innerHTML = '<h3 class="devc-h3">Flora & Fauna</h3>';
  const resetBtn = document.createElement("button");
  resetBtn.className = "ff-reset";
  resetBtn.textContent = "Standard";
  resetBtn.title = "Auf Standardwerte zurücksetzen";
  head.append(resetBtn);
  root.append(head);

  const emit = (key: string, value: number): void => {
    bus.emit("flora-fauna:param", { key, value });
  };

  // Track widgets so Reset can restore them without rebuilding the DOM.
  const widgets: { spec: Spec; set(v: number): void }[] = [];

  const buildSpec = (spec: Spec, parent: HTMLElement): void => {
    const row = document.createElement("div");
    row.className = "ff-row";
    const label = document.createElement("label");
    label.className = "ff-label";
    label.textContent = spec.label;
    const start = startValue(config, spec.key);

    if (spec.kind === "slider" || spec.kind === "count") {
      // Counts use the same field + slider UI as continuous values, but their
      // supported range is a real runtime capacity rather than a display hint.
      const boundedCount = spec.kind === "count";
      const value = document.createElement("input");
      value.type = "number";
      value.className = "ff-valnum";
      if (boundedCount) {
        value.min = String(spec.min);
        value.max = String(spec.max);
      }
      value.step = String(spec.step);
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      const displayStart = boundedCount ? Math.round(clamp(start, spec.min, spec.max)) : start;
      input.value = String(clamp(displayStart, spec.min, spec.max));
      value.value = fmt(displayStart, spec.step);
      input.addEventListener("input", () => {
        const v = Number.parseFloat(input.value);
        if (document.activeElement !== value) value.value = fmt(v, spec.step);
        emit(spec.key, v);
      });
      const commitValue = (): void => {
        const raw = Number.parseFloat(value.value);
        if (!Number.isFinite(raw)) return;
        const v = boundedCount ? Math.round(clamp(raw, spec.min, spec.max)) : raw;
        input.value = String(clamp(v, spec.min, spec.max));
        if (boundedCount) value.value = fmt(v, spec.step);
        emit(spec.key, v);
      };
      value.addEventListener("input", commitValue);
      value.addEventListener("change", commitValue);
      value.addEventListener("keydown", (e) => e.stopPropagation()); // typing here ≠ global hotkeys
      row.append(label, value, input);
      widgets.push({
        spec,
        set: (v) => {
          input.value = String(clamp(v, spec.min, spec.max));
          value.value = fmt(v, spec.step);
        },
      });
    } else {
      // Editable number field — exact counts, uncapped past `max` when typed.
      const input = document.createElement("input");
      input.type = "number";
      input.className = "ff-num";
      input.min = String(spec.min);
      input.step = String(spec.step);
      input.value = String(Math.round(start));
      input.addEventListener("change", () => {
        const v = Number.parseFloat(input.value);
        if (Number.isFinite(v)) emit(spec.key, v);
      });
      input.addEventListener("keydown", (e) => e.stopPropagation()); // typing here ≠ global hotkeys
      row.append(label, input);
      widgets.push({
        spec,
        set: (v) => {
          input.value = String(Math.round(v));
        },
      });
    }
    parent.append(row);
  };

  for (const group of GROUPS) {
    const details = document.createElement("details");
    details.className = "ff-group";
    if (group.open) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.append(summary);
    for (const spec of group.specs) buildSpec(spec, details);
    root.append(details);
  }

  resetBtn.addEventListener("click", () => {
    for (const { spec, set } of widgets) {
      const def = startValue(DEFAULT_CONFIG, spec.key);
      set(def);
      emit(spec.key, def);
    }
  });

  return {
    element: root,
    dispose(): void {
      root.remove();
    },
  };
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.ff-root { display: flex; flex-direction: column; gap: 8px; }
.ff-head { display: flex; align-items: center; justify-content: space-between; }
.ff-head .devc-h3 { margin: 0; }
.ff-reset {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 10px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; text-transform: uppercase; letter-spacing: 0.05em;
}
.ff-reset:hover { color: #38bdf8; border-color: #38bdf8; }
.ff-group { border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 8px 8px; }
.ff-group > summary {
  cursor: pointer; list-style: none; padding: 6px 0; font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: #a1a1aa; user-select: none;
}
.ff-group > summary::-webkit-details-marker { display: none; }
.ff-group > summary::before { content: "▸ "; color: #52525b; }
.ff-group[open] > summary::before { content: "▾ "; }
.ff-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; margin: 6px 0; }
.ff-label { font-size: 11px; color: #a1a1aa; }
.ff-val { font-size: 11px; color: #38bdf8; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.ff-row input[type="range"] { grid-column: 1 / -1; width: 100%; height: 16px; accent-color: #38bdf8; cursor: pointer; }
.ff-num {
  width: 64px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #38bdf8; font-family: inherit; font-size: 11px; font-weight: 600;
  padding: 2px 6px; text-align: right; font-variant-numeric: tabular-nums;
}
.ff-num:focus { outline: none; border-color: #38bdf8; }
.ff-valnum {
  width: 72px; background: transparent; border: none; color: #38bdf8;
  font-family: inherit; font-size: 11px; font-weight: 600; text-align: right;
  font-variant-numeric: tabular-nums; padding: 0; outline: none;
  appearance: textfield; -moz-appearance: textfield;
}
.ff-valnum::-webkit-outer-spin-button, .ff-valnum::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ff-valnum:focus { border-bottom: 1px solid #38bdf8; }
`;
