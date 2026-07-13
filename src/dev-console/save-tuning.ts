// ── Becoming Many — Save tuning (dev GUI) ──────────────────────
//
// A dev-only section inside the C dev console that exports the live tuning as
// committed `state.json` files (Theatre / synthi pattern). The button is an
// editor affordance so it lives here; the serialize/load logic and the files
// themselves live with the content (src/senses/state.ts, src/terrain/state.ts).
//
// "Persist to disk" is manual, exactly like the synthi: the button downloads a
// blob, the developer moves it onto src/{senses,terrain}/state.json and commits.
// Distinct download names avoid a Downloads-folder collision between the two.

const STYLE_ID = "devc-save-styles";

export interface SaveTuningControls {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  dispose(): void;
}

/** Serialize `data` to pretty JSON and trigger a browser download. */
function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build the "Speichern" section. `serializeSenses` / `serializeWorld` are called
 * lazily on click so the export always reflects the current live tuning.
 */
export function createSaveTuningControls(opts: {
  serializeSenses(): unknown;
  serializeWorld(): unknown;
}): SaveTuningControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section st-root";

  const head = document.createElement("div");
  head.className = "st-head";
  head.innerHTML = '<h3 class="devc-h3">Speichern</h3>';
  root.append(head);

  const row = document.createElement("div");
  row.className = "st-actions";

  const sensesBtn = document.createElement("button");
  sensesBtn.textContent = "⤓ Sinne";
  sensesBtn.title = "Sinnes-Zustand als senses-state.json exportieren";
  sensesBtn.addEventListener("click", () => downloadJson("senses-state.json", opts.serializeSenses()));

  const worldBtn = document.createElement("button");
  worldBtn.textContent = "⤓ World";
  worldBtn.title = "Welt-Zustand als terrain-state.json exportieren";
  worldBtn.addEventListener("click", () => downloadJson("terrain-state.json", opts.serializeWorld()));

  row.append(sensesBtn, worldBtn);
  root.append(row);

  const hint = document.createElement("p");
  hint.className = "st-hint";
  hint.textContent = "→ src/senses/state.json · src/terrain/state.json";
  root.append(hint);

  return {
    element: root,
    dispose(): void {
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
.st-root { display: flex; flex-direction: column; gap: 6px; }
.st-head .devc-h3 { margin: 0; }
.st-actions { display: flex; gap: 4px; }
.st-actions button {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 11px; padding: 4px 10px; cursor: pointer;
  font-family: inherit; letter-spacing: 0.03em;
}
.st-actions button:hover { color: #38bdf8; border-color: #38bdf8; }
.st-hint { margin: 0; font-size: 10px; color: #52525b; font-variant-numeric: tabular-nums; }
`;
