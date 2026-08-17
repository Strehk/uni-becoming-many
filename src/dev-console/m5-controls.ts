/**
 * M5 controller panel for the C dev console.
 *
 * The operator surface for the rig: is a controller attached, what is it reading right now, and
 * the two tuning actions that used to live in the ICAROS host's web console — calibrate the rest
 * pose to neutral, and correct how the controller is mounted.
 *
 * Both actions travel to the bridge, not into local state: calibration belongs to the *station*,
 * so it is persisted there and every browser that connects sees the same zero.
 */
import type { AxisMapField, Controller } from "../m5/index.ts";

const STYLE_ID = "devc-m5-styles";

/** ~8 updates/s. The stream runs at 20 Hz; re-rendering every frame just makes it unreadable. */
const TEXT_INTERVAL_MS = 120;

const AXIS_FIELDS: readonly { field: AxisMapField; label: string }[] = [
  { field: "swapPitchRoll", label: "Achsen tauschen" },
  { field: "invertPitch", label: "Pitch umkehren" },
  { field: "invertRoll", label: "Roll umkehren" },
];

const STATUS_LABELS: Readonly<Record<string, { text: string; color: string }>> = {
  offline: { text: "keine Bridge", color: "#f87171" },
  waiting: { text: "wartet auf Controller", color: "#facc15" },
  live: { text: "live", color: "#4ade80" },
};

export interface M5Panel {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  /** Refresh the live readouts. Call once per frame; it throttles itself. */
  update(): void;
  dispose(): void;
}

export function createM5Controls(controller: Controller): M5Panel {
  injectStyles();

  const element = document.createElement("section");
  element.className = "devc-section devc-m5";
  element.innerHTML = PANEL_HTML;

  const node = (key: string): HTMLElement => {
    const found = element.querySelector<HTMLElement>(`[data-m5="${key}"]`);
    if (!found) {
      throw new Error(`m5 panel: missing node "${key}"`);
    }
    return found;
  };

  const els = {
    status: node("status"),
    pitch: node("pitch"),
    roll: node("roll"),
    quality: node("quality"),
    button: node("button"),
    calibratedAt: node("calibratedAt"),
    bar: node("bar"),
    barFill: node("barFill"),
  };

  const axisInputs = new Map<AxisMapField, HTMLInputElement>();
  const axisRow = node("axes");
  for (const { field, label } of AXIS_FIELDS) {
    const wrapper = document.createElement("label");
    wrapper.className = "devc-m5__check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => controller.setAxisField(field, input.checked));
    wrapper.append(input, document.createTextNode(label));
    axisRow.append(wrapper);
    axisInputs.set(field, input);
  }

  const calibrateButton = node("calibrate");
  calibrateButton.addEventListener("click", () => controller.calibrate());
  node("reset").addEventListener("click", () => controller.resetCalibration());

  /** Mirror bridge-owned state into the widgets — the panel never holds its own copy. */
  const syncFromBridge = (): void => {
    const status = STATUS_LABELS[controller.status] ?? STATUS_LABELS["offline"];
    if (status) {
      els.status.textContent = status.text;
      els.status.style.color = status.color;
    }

    const state = controller.bridgeState;
    if (state === null) {
      els.calibratedAt.textContent = "–";
      return;
    }
    for (const [field, input] of axisInputs) {
      input.checked = state.axisMap[field];
    }
    els.calibratedAt.textContent = state.calibration.calibratedAt
      ? new Date(state.calibration.calibratedAt).toLocaleString("de-DE")
      : "nie";
  };

  const detach = controller.onChange(syncFromBridge);
  syncFromBridge();

  let lastUpdate = 0;

  return {
    element,

    update(): void {
      const now = performance.now();
      if (now - lastUpdate < TEXT_INTERVAL_MS) {
        return;
      }
      lastUpdate = now;

      const { input } = controller;
      els.pitch.textContent = input.pitch.toFixed(2);
      els.roll.textContent = input.roll.toFixed(2);
      els.quality.textContent = input.quality.toFixed(2);
      els.button.textContent = input.button.pressed ? "gedrückt" : "–";
      els.button.style.color = input.button.pressed ? "#38bdf8" : "#71717a";

      // A two-sided bar: centre is neutral, so a mis-calibrated rig is visible at a glance.
      els.barFill.style.left = `${50 + Math.min(0, input.roll) * 50}%`;
      els.barFill.style.width = `${Math.abs(input.roll) * 50}%`;
      els.bar.style.opacity = input.quality > 0 ? "1" : "0.3";
    },

    dispose(): void {
      detach();
      element.remove();
    },
  };
}

const PANEL_HTML = `
  <h3 class="devc-h3">M5 Controller</h3>
  <div class="devc-kv"><span>Status</span><b data-m5="status">–</b></div>
  <div class="devc-grid">
    <div class="devc-metric"><span>Pitch</span><b data-m5="pitch">0.00</b></div>
    <div class="devc-metric"><span>Roll</span><b data-m5="roll">0.00</b></div>
    <div class="devc-metric"><span>Quality</span><b data-m5="quality">0.00</b></div>
    <div class="devc-metric"><span>Button</span><b data-m5="button">–</b></div>
  </div>
  <div class="devc-m5__bar" data-m5="bar"><i data-m5="barFill"></i></div>
  <div class="devc-m5__axes" data-m5="axes"></div>
  <div class="devc-kv"><span>Kalibriert</span><b data-m5="calibratedAt">–</b></div>
  <div class="devc-m5__actions">
    <button type="button" class="devc-m5__button" data-m5="calibrate">Neutral kalibrieren</button>
    <button type="button" class="devc-m5__button" data-m5="reset">Zurücksetzen</button>
  </div>
`;

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
.devc-m5__bar {
  position: relative; height: 6px; margin: 10px 0;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);
}
.devc-m5__bar::before {
  content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px;
  width: 1px; background: rgba(255,255,255,0.25);
}
.devc-m5__bar i { position: absolute; top: 0; bottom: 0; background: #38bdf8; }
.devc-m5__axes { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.devc-m5__check { display: flex; align-items: center; gap: 6px; color: #a1a1aa; cursor: pointer; }
.devc-m5__actions { display: flex; gap: 6px; margin-top: 8px; }
.devc-m5__button {
  flex: 1; padding: 5px 8px; cursor: pointer;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  color: #e6e6e6; font: inherit; font-size: 11px;
}
.devc-m5__button:hover { background: rgba(56,189,248,0.15); border-color: #38bdf8; }
`;
