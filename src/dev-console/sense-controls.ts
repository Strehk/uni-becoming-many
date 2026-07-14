// ── Becoming Many — Shared Sense Controls (dev GUI) ────────────
//
// The central manual test surface for the nine sense layers, mounted inside the C
// dev console (via `devConsole.addSection`). One collapsible card per sense:
//
//   • toggle / solo + intensity slider  → bus commands `sense:toggle|solo|set`
//   • sense-specific parameters         → bus command  `sense:param {id,key,value}`
//   • blend mode + layer order          → bus commands `sense:blend` / `sense:move`
//     (shader senses only — structural, triggers a shader rebuild)
//
// The panel never writes `signals.sense[id]` directly: every action is a bus command,
// the exact same channel the number keys and any future controller use, and the same
// signals Theatre drives. It *subscribes* to the sense signals so external changes
// (keys, Theatre timeline) are reflected live.
//
// Parameter widgets are rendered from UI-agnostic descriptors (`senseControls()` of
// the ShaderSinne port; later modules register their own with `add()`), so the panel
// knows no module internals.

import { SENSE_KEY_ORDER, SENSE_LABELS } from "../senses/ids.ts";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";

const STYLE_ID = "devc-sense-styles";

/** A single widget descriptor (live `get` binding; writes go over the bus). */
export type PanelControl =
  | {
      type: "range";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      digits?: number;
      get(): number;
    }
  | { type: "color"; key: string; label: string; get(): string }
  | { type: "check"; key: string; label: string; get(): boolean }
  | {
      type: "presets";
      label: string;
      options: { label: string; values: Record<string, string> }[];
    };

/** What a sense module hands the panel to become configurable. */
export interface SensePanelDescriptor {
  /** Must match a SenseId — the card the controls are mounted into. */
  key: string;
  description?: string;
  /** Blend-mode select (shader senses; structural). */
  blend?: { options: { value: string; label: string }[]; get(): string } | null;
  /** Show layer-order buttons (shader senses; structural). */
  movable?: boolean;
  controls: PanelControl[];
}

export interface SenseControlsPanel {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  /** Mount a module's parameter descriptor into its sense card (idempotent per key). */
  add(descriptor: SensePanelDescriptor): void;
  dispose(): void;
}

const fmt = (v: number, digits: number): string => v.toFixed(digits);

/** The value readout as a directly editable number field. Typing commits on
 *  change/Enter and is NOT clamped to the slider's range — the slider is a
 *  convenience, the field is the escape hatch past its preset maximum. */
function numberValue(
  step: number,
  digits: number,
  onCommit: (v: number) => void,
): { input: HTMLInputElement; show: (v: number) => void } {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "sc-val";
  input.step = String(step);
  input.addEventListener("change", () => {
    const v = Number.parseFloat(input.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  input.addEventListener("keydown", (e) => e.stopPropagation()); // digits ≠ sense hotkeys
  return {
    input,
    show(v: number): void {
      // Never fight the user's cursor: only mirror while not being edited.
      if (document.activeElement !== input) input.value = fmt(v, digits);
    },
  };
}

export function createSenseControls(
  bus: Bus,
  initial: SensePanelDescriptor[] = [],
): SenseControlsPanel {
  injectStyles();
  const unsubscribes: (() => void)[] = [];

  const root = document.createElement("section");
  root.className = "devc-section sc-root";

  // ── header: title + authority switch + all-off ──
  const head = document.createElement("div");
  head.className = "sc-head";
  head.innerHTML = '<h3 class="devc-h3">Sinne</h3>';
  const authority = document.createElement("div");
  authority.className = "sc-authority";
  const manualBtn = document.createElement("button");
  manualBtn.textContent = "Manuell";
  const theatreBtn = document.createElement("button");
  theatreBtn.textContent = "Theatre";
  authority.append(manualBtn, theatreBtn);
  const clearBtn = document.createElement("button");
  clearBtn.className = "sc-clear";
  clearBtn.textContent = "Alle aus";
  head.append(authority, clearBtn);
  root.append(head);

  const reflectAuthority = (mode: string): void => {
    manualBtn.classList.toggle("on", mode === "manual");
    theatreBtn.classList.toggle("on", mode === "theatre");
  };
  reflectAuthority(signals.senseAuthority.peek());
  unsubscribes.push(signals.senseAuthority.subscribe(reflectAuthority));
  // The UI is a sanctioned writer of the authority switch (see registry annotation).
  manualBtn.addEventListener("click", () => {
    signals.senseAuthority.value = "manual";
  });
  theatreBtn.addEventListener("click", () => {
    signals.senseAuthority.value = "theatre";
  });
  clearBtn.addEventListener("click", () => bus.emit("sense:clear"));

  // ── one card per sense ──
  const paramMounts = new Map<string, HTMLElement>();
  const mountedKeys = new Set<string>();

  SENSE_KEY_ORDER.forEach((id, index) => {
    const card = document.createElement("details");
    card.className = "sc-card";

    const summary = document.createElement("summary");
    const dot = document.createElement("span");
    dot.className = "sc-dot";
    const title = document.createElement("span");
    title.className = "sc-title";
    const key = (index + 1) % 10; // the digit key for this slot — slot 10 sits on "0"
    title.textContent = id === null ? `${key} · Luft` : `${key} · ${SENSE_LABELS[id]}`;
    const pct = document.createElement("b");
    pct.className = "sc-pct";
    summary.append(dot, title, pct);
    card.append(summary);

    if (id === null) {
      const row = document.createElement("div");
      row.className = "sc-actions";
      const clearSlotBtn = document.createElement("button");
      clearSlotBtn.textContent = "Aktivieren";
      clearSlotBtn.title = "Alle Sinneslayer ausschalten";
      clearSlotBtn.addEventListener("click", () => bus.emit("sense:clear"));
      row.append(clearSlotBtn);
      card.append(row);

      const reflectLuft = (active: string): void => {
        const on = active === "none";
        dot.classList.toggle("on", on);
        pct.textContent = on ? "an" : "";
      };
      reflectLuft(signals.activeSense.peek());
      unsubscribes.push(signals.activeSense.subscribe(reflectLuft));
      root.append(card);
      return;
    }

    // toggle / solo row
    const row = document.createElement("div");
    row.className = "sc-actions";
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "An / Aus";
    toggleBtn.addEventListener("click", () => bus.emit("sense:toggle", { id }));
    const soloBtn = document.createElement("button");
    soloBtn.textContent = "Solo";
    soloBtn.title = "Nur diesen Sinn aktivieren";
    soloBtn.addEventListener("click", () => bus.emit("sense:solo", { id }));
    row.append(toggleBtn, soloBtn);
    card.append(row);

    // intensity slider — the layer's signal value (number field commits too)
    const intensityRow = document.createElement("div");
    intensityRow.className = "sc-row";
    const label = document.createElement("label");
    label.className = "sc-label";
    label.textContent = "Intensität";
    const value = numberValue(0.01, 2, (v) => bus.emit("sense:set", { id, value: v }));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.addEventListener("input", () => {
      bus.emit("sense:set", { id, value: Number.parseFloat(slider.value) });
    });
    intensityRow.append(label, value.input, slider);
    card.append(intensityRow);

    // parameter mount point (filled by descriptors)
    const params = document.createElement("div");
    params.className = "sc-params";
    card.append(params);
    paramMounts.set(id, params);

    const reflect = (v: number): void => {
      dot.classList.toggle("on", v > 0);
      pct.textContent = `${Math.round(v * 100)}%`;
      slider.value = String(v);
      value.show(v);
    };
    reflect(signals.sense[id].peek());
    unsubscribes.push(signals.sense[id].subscribe(reflect));

    root.append(card);
  });

  // ── descriptor mounting ──
  const buildParamWidgets = (descriptor: SensePanelDescriptor, mount: HTMLElement): void => {
    if (descriptor.description) {
      const p = document.createElement("p");
      p.className = "sc-desc";
      p.textContent = descriptor.description;
      mount.append(p);
    }

    if (descriptor.blend) {
      const blendRow = document.createElement("label");
      blendRow.className = "sc-blend";
      blendRow.innerHTML = "<span>Blend</span>";
      const select = document.createElement("select");
      for (const opt of descriptor.blend.options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        select.append(o);
      }
      select.value = descriptor.blend.get();
      select.addEventListener("change", () => {
        bus.emit("sense:blend", { id: descriptor.key, mode: select.value });
      });
      blendRow.append(select);
      mount.append(blendRow);
    }

    if (descriptor.movable) {
      const orderRow = document.createElement("div");
      orderRow.className = "sc-actions";
      const up = document.createElement("button");
      up.textContent = "▲ früher";
      up.title = "Ebene früher anwenden (weiter unten im Stapel)";
      up.addEventListener("click", () => bus.emit("sense:move", { id: descriptor.key, dir: -1 }));
      const down = document.createElement("button");
      down.textContent = "▼ später";
      down.title = "Ebene später anwenden (weiter oben im Stapel)";
      down.addEventListener("click", () => bus.emit("sense:move", { id: descriptor.key, dir: 1 }));
      orderRow.append(up, down);
      mount.append(orderRow);
    }

    for (const control of descriptor.controls) {
      if (control.type === "range") {
        const row = document.createElement("div");
        row.className = "sc-row";
        const l = document.createElement("label");
        l.className = "sc-label";
        l.textContent = control.label;
        const digits = control.digits ?? 2;
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step);
        // Typed values pass through UNCLAMPED — the slider covers the curated
        // range, the number field goes past its preset maximum when needed.
        const val = numberValue(control.step, digits, (v) => {
          input.value = String(v); // browser clamps the slider display; the value stands
          bus.emit("sense:param", { id: descriptor.key, key: control.key, value: v });
        });
        const start = control.get();
        input.value = String(start);
        val.show(start);
        input.addEventListener("input", () => {
          const v = Number.parseFloat(input.value);
          val.show(v);
          bus.emit("sense:param", { id: descriptor.key, key: control.key, value: v });
        });
        row.append(l, val.input, input);
        mount.append(row);
      } else if (control.type === "color") {
        const row = document.createElement("label");
        row.className = "sc-color";
        const span = document.createElement("span");
        span.textContent = control.label;
        const input = document.createElement("input");
        input.type = "color";
        input.value = control.get();
        input.addEventListener("input", () => {
          bus.emit("sense:param", { id: descriptor.key, key: control.key, value: input.value });
        });
        row.append(span, input);
        mount.append(row);
      } else if (control.type === "check") {
        const row = document.createElement("label");
        row.className = "sc-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = control.get();
        input.addEventListener("change", () => {
          bus.emit("sense:param", { id: descriptor.key, key: control.key, value: input.checked });
        });
        const span = document.createElement("span");
        span.textContent = control.label;
        row.append(input, span);
        mount.append(row);
      } else {
        const row = document.createElement("div");
        row.className = "sc-presets";
        const span = document.createElement("span");
        span.textContent = control.label;
        row.append(span);
        for (const option of control.options) {
          const btn = document.createElement("button");
          btn.textContent = option.label;
          btn.addEventListener("click", () => {
            // A preset is just a bundle of parameter commands.
            for (const [key, hex] of Object.entries(option.values)) {
              bus.emit("sense:param", { id: descriptor.key, key, value: hex });
            }
          });
          row.append(btn);
        }
        mount.append(row);
      }
    }
  };

  const add = (descriptor: SensePanelDescriptor): void => {
    const mount = paramMounts.get(descriptor.key);
    if (!mount || mountedKeys.has(descriptor.key)) {
      return;
    }
    mountedKeys.add(descriptor.key);
    buildParamWidgets(descriptor, mount);
  };

  for (const d of initial) {
    add(d);
  }

  return {
    element: root,
    add,
    dispose(): void {
      for (const off of unsubscribes) {
        off();
      }
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
.sc-root { display: flex; flex-direction: column; gap: 6px; }
.sc-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.sc-head .devc-h3 { margin: 0; flex: 1; }
.sc-authority { display: flex; gap: 2px; }
.sc-authority button, .sc-clear, .sc-actions button, .sc-presets button {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 10px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; letter-spacing: 0.03em;
}
.sc-authority button.on { color: #38bdf8; border-color: #38bdf8; }
.sc-authority button:hover, .sc-clear:hover, .sc-actions button:hover,
.sc-presets button:hover { color: #e6e6e6; border-color: rgba(255,255,255,0.4); }

.sc-card { border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 8px 6px; }
.sc-card > summary {
  cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
  padding: 6px 0; user-select: none;
}
.sc-card > summary::-webkit-details-marker { display: none; }
.sc-dot {
  width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.15);
  flex-shrink: 0; transition: background 0.2s, box-shadow 0.2s;
}
.sc-dot.on { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.sc-title { flex: 1; font-size: 11px; color: #d4d4d8; }
.sc-pct { font-size: 10px; color: #71717a; font-variant-numeric: tabular-nums; }

.sc-actions { display: flex; gap: 4px; margin: 4px 0; }
.sc-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; margin: 5px 0; }
.sc-label { font-size: 11px; color: #a1a1aa; }
.sc-val {
  font-size: 11px; color: #38bdf8; font-weight: 600; text-align: right;
  font-variant-numeric: tabular-nums; background: transparent; border: none;
  font-family: inherit; width: 72px; padding: 0; outline: none; appearance: textfield;
  -moz-appearance: textfield;
}
.sc-val::-webkit-outer-spin-button, .sc-val::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.sc-val:focus { border-bottom: 1px solid #38bdf8; }
.sc-row input[type="range"] { grid-column: 1 / -1; width: 100%; height: 14px; accent-color: #38bdf8; cursor: pointer; }

.sc-desc { margin: 4px 0; font-size: 10px; color: #71717a; line-height: 1.4; }
.sc-blend { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.sc-blend > span { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
.sc-blend select {
  flex: 1; min-width: 0; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 3px; color: #e6e6e6;
  font-family: inherit; font-size: 11px; padding: 2px 6px;
}
.sc-color { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 5px 0; }
.sc-color > span { font-size: 11px; color: #a1a1aa; }
.sc-color input { width: 40px; height: 20px; border: none; background: none; padding: 0; cursor: pointer; }
.sc-check { display: flex; align-items: center; gap: 6px; margin: 5px 0; font-size: 11px; color: #a1a1aa; }
.sc-presets { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 5px 0; }
.sc-presets > span { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
`;
