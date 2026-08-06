// ── Becoming Many — Performance Controls (dev GUI) ─────────────
//
// The Performance panel inside the C dev console (via `devConsole.addSection`),
// sitting beside the World / Flora & Fauna panels it mirrors in style. It exposes
// the highest-impact quality knobs found in the perf audit, plus four presets
// (Niedrig / Mittel / Hoch / Ultra) that set every knob at once:
//
//   • Rendering — pixel-ratio cap (fragment cost ∝ scale²).
//   • Gras      — draw radius + keep fraction (pure uniforms, effective next frame).
//   • Terrain   — chunk build radius (scheduler window, no rebuild).
//   • Flora / Fauna — density + counts over the `flora-fauna:param` bus (the
//     coordinator debounces + re-scatters/rebuilds, same as the F&F panel).
//   • Sinne     — duft particle budget + cheap turbulence, motion trail length,
//     over `sense:param` (the modules' own live channel).
//
// Persistence is split by owner: renderScale / grass / stream radius live in
// src/perf/state.json (⤓ Performance button); flora/fauna and duft/motion values
// persist through their own state.json exports. The FPS/CPU/GPU readout already
// lives in the console head (dev-console/index.ts) — this panel adds no sampling.

import { PRESETS, type Preset } from "../perf/presets.ts";
import { CUSTOM_PRESET_ID, type PerfRouter } from "../perf/router.ts";

const STYLE_ID = "devc-perf-styles";

export interface PerformanceControls {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  /** Detach the DOM. */
  dispose(): void;
}

export interface PerformanceControlsOptions {
  /**
   * The shared knob routing (src/perf/router.ts). Shared with the audience
   * Einstellungen screen, so a preset chosen there moves these sliders too.
   */
  router: PerfRouter;
}

type KnobSpec = {
  /** Preset key — also the routing id (see `route` in createPerformanceControls). */
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
};

type GroupSpec = { title: string; open?: boolean; knobs: KnobSpec[] };

const GROUPS: GroupSpec[] = [
  {
    title: "Rendering",
    open: true,
    knobs: [
      { id: "renderScale", label: "Render Scale (Pixel-Ratio)", min: 0.5, max: 2, step: 0.25 },
    ],
  },
  {
    title: "Gras",
    open: true,
    knobs: [
      { id: "grassRadius", label: "Radius (m)", min: 12, max: 48, step: 2 },
      { id: "grassKeepFraction", label: "Dichte", min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Terrain",
    knobs: [{ id: "streamBuildRadius", label: "Chunk-Radius", min: 1, max: 2, step: 1 }],
  },
  {
    title: "Flora",
    knobs: [
      { id: "floraViewDistance", label: "Sichtweite (m, 896 = aus)", min: 200, max: 896, step: 32 },
      { id: "flora.globalDensity", label: "Gesamtdichte", min: 0, max: 2, step: 0.05 },
      { id: "flora.treeDensity", label: "Baumdichte", min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    title: "Fauna",
    knobs: [
      { id: "fauna.mosquitoSwarmCount", label: "Mückenschwärme", min: 0, max: 48, step: 1 },
      { id: "fauna.flockCount", label: "Vogelschwärme", min: 1, max: 16, step: 1 },
      { id: "fauna.deerCount", label: "Rehe", min: 0, max: 32, step: 1 },
      { id: "fauna.foxCount", label: "Füchse", min: 0, max: 32, step: 1 },
      { id: "fauna.batFlockCount", label: "Fledermaus-Gruppen", min: 1, max: 16, step: 1 },
      { id: "fauna.meiseFlockCount", label: "Meisen-Gruppen", min: 0, max: 16, step: 1 },
      {
        id: "fauna.butterflyFlockCount",
        label: "Schmetterlings-Gruppen",
        min: 0,
        max: 16,
        step: 1,
      },
    ],
  },
  {
    title: "Sinne",
    knobs: [
      { id: "duft.count", label: "Duft-Partikel", min: 20000, max: 400000, step: 20000 },
      { id: "motion.lifetimeFrames", label: "Motion-Trail (Frames)", min: 2, max: 40, step: 1 },
      { id: "rundum.cubeSize", label: "Rundum-Auflösung (px)", min: 256, max: 2048, step: 256 },
      {
        id: "rundum.captureInterval",
        label: "Rundum-Aufnahme (jede N. Frame)",
        min: 1,
        max: 4,
        step: 1,
      },
    ],
  },
];

const decimals = (step: number): number =>
  step >= 1 ? 0 : (String(step).split(".")[1]?.length ?? 2);
const fmt = (v: number, step: number): string =>
  step >= 1000 ? `${Math.round(v / 1000)}k` : v.toFixed(decimals(step));

/**
 * Build the Performance panel. Returns the section element (mount via
 * `devConsole.addSection`) plus a `dispose`.
 */
export function createPerformanceControls(opts: PerformanceControlsOptions): PerformanceControls {
  injectStyles();
  const { router } = opts;
  const { senseLive } = router;

  const root = document.createElement("section");
  root.className = "devc-section pc-root";

  const head = document.createElement("div");
  head.className = "pc-head";
  head.innerHTML = '<h3 class="devc-h3">Performance</h3>';
  root.append(head);

  // --- Presets ---------------------------------------------------------------
  // The buttons only *ask* the router; the visual sync happens in the
  // `onPresetApplied` handler below, so a preset chosen in the audience
  // Einstellungen screen moves these sliders exactly the same way.
  const presetRow = document.createElement("div");
  presetRow.className = "pc-presets";
  const presetButtons = new Map<string, HTMLButtonElement>();
  const markPreset = (id: string): void => {
    for (const [pid, btn] of presetButtons) {
      btn.classList.toggle("pc-preset-active", pid === id);
    }
  };

  // Track slider UI so an applied preset can move the controls along with the values.
  const sliderUi = new Map<
    string,
    { input: HTMLInputElement; valueEl: HTMLElement; step: number }
  >();

  // Duft cheap-turbulence checkbox (shared between its row + the presets).
  const cheapInput = document.createElement("input");
  cheapInput.type = "checkbox";

  const syncFromPreset = (preset: Preset): void => {
    for (const [id, value] of Object.entries(preset.values)) {
      const ui = sliderUi.get(id);
      if (!ui) continue;
      ui.input.value = String(value);
      ui.valueEl.textContent = fmt(value, ui.step);
    }
    cheapInput.checked = preset.cheapNoise;
    markPreset(preset.id);
  };
  const offPreset = router.onPresetApplied(syncFromPreset);

  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "pc-preset";
    btn.textContent = preset.label;
    btn.title = `Alle Regler auf „${preset.label}" setzen`;
    btn.addEventListener("click", () => router.applyPreset(preset));
    presetButtons.set(preset.id, btn);
    presetRow.append(btn);
  }
  root.append(presetRow);

  // --- Knob groups -----------------------------------------------------------
  for (const group of GROUPS) {
    const details = document.createElement("details");
    details.className = "pc-group";
    if (group.open) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.append(summary);

    for (const spec of group.knobs) {
      const knob = router.route(spec.id);
      const row = document.createElement("div");
      row.className = "pc-row";

      const labelEl = document.createElement("label");
      labelEl.className = "pc-label";
      labelEl.textContent = spec.label;

      const valueEl = document.createElement("b");
      valueEl.className = "pc-val";

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      const start = Math.min(spec.max, Math.max(spec.min, knob.get()));
      input.value = String(start);
      valueEl.textContent = fmt(start, spec.step);

      input.addEventListener("input", () => {
        const v = Number.parseFloat(input.value);
        valueEl.textContent = fmt(v, spec.step);
        knob.set(v);
        router.markCustom();
        markPreset(CUSTOM_PRESET_ID);
      });

      row.append(labelEl, valueEl, input);
      details.append(row);
      sliderUi.set(spec.id, { input, valueEl, step: spec.step });

      // The duft cheap-noise toggle rides directly under the duft particle slider.
      if (spec.id === "duft.count") {
        const check = document.createElement("label");
        check.className = "pc-check";
        cheapInput.checked = senseLive.duftCheapNoise;
        cheapInput.addEventListener("change", () => {
          router.setCheapNoise(cheapInput.checked);
          router.markCustom();
          markPreset(CUSTOM_PRESET_ID);
        });
        const span = document.createElement("span");
        span.textContent = "Duft: billige Turbulenz (~3× schneller)";
        check.append(cheapInput, span);
        details.append(check);
      }
    }
    root.append(details);
  }

  markPreset(router.activePreset);

  const hint = document.createElement("p");
  hint.className = "pc-hint";
  hint.textContent =
    "Speichern: ⤓ Performance (Render/Gras/Terrain) · Flora-, Fauna- und Sinne-Werte über deren eigene Buttons";
  root.append(hint);

  return {
    element: root,
    dispose(): void {
      offPreset();
      root.remove();
    },
  };
}

// ── styles (injected once) ──

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.pc-root { display: flex; flex-direction: column; gap: 8px; }
.pc-head .devc-h3 { margin: 0; }

.pc-presets { display: flex; gap: 4px; }
.pc-preset {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 10px; padding: 4px 0; cursor: pointer;
  font-family: inherit; text-transform: uppercase; letter-spacing: 0.05em;
}
.pc-preset:hover { color: #38bdf8; border-color: #38bdf8; }
.pc-preset-active { color: #38bdf8; border-color: #38bdf8; background: rgba(56,189,248,0.12); }

.pc-group { border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 8px 8px; }
.pc-group[open] { padding-bottom: 10px; }
.pc-group > summary {
  cursor: pointer; list-style: none; padding: 6px 0; font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: #a1a1aa; user-select: none;
}
.pc-group > summary::-webkit-details-marker { display: none; }
.pc-group > summary::before { content: "▸ "; color: #52525b; }
.pc-group[open] > summary::before { content: "▾ "; }

.pc-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; margin: 6px 0; }
.pc-label { font-size: 11px; color: #a1a1aa; }
.pc-val { font-size: 11px; color: #38bdf8; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.pc-row input[type="range"] { grid-column: 1 / -1; width: 100%; height: 16px; accent-color: #38bdf8; cursor: pointer; }

.pc-check { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; color: #a1a1aa; cursor: pointer; }
.pc-check input { accent-color: #38bdf8; }

.pc-hint { margin: 0; font-size: 10px; color: #52525b; }
`;
