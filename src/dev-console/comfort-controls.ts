// ── Becoming Many — Comfort Controls (dev GUI) ─────────────────
//
// A small section inside the C dev console for view-comfort tuning. Currently
// one slider: the **VR world tilt** — a constant downward pitch of the rendered
// world that eases neck strain in prone (ICAROS) flight (see
// `Player.setWorldTilt`). It only takes effect in the headset; the flat page is
// never tilted, so a nonzero value here does nothing on a laptop.
//
// The live value is persisted (localStorage) via the injected `onChange`, so a
// setting made on the headset survives a reload without a keyboard or a commit.

import { MAX_WORLD_TILT_DEG } from "../experience/comfort.ts";

const STYLE_ID = "devc-comfort-styles";

export interface ComfortControls {
  /** The section element to hand to `devConsole.addSection`. */
  readonly element: HTMLElement;
  dispose(): void;
}

export function createComfortControls(opts: {
  /** Starting tilt, in degrees (from the persisted config). */
  initialTiltDeg: number;
  /** Called on every slider edit with the new tilt in degrees (persist + apply live). */
  onTiltChange: (deg: number) => void;
}): ComfortControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section cf-root";

  const heading = document.createElement("h3");
  heading.className = "devc-h3";
  heading.textContent = "Komfort";
  root.append(heading);

  const row = document.createElement("label");
  row.className = "cf-row";

  const label = document.createElement("span");
  label.className = "cf-label";
  label.textContent = "Welt-Neigung (VR)";
  label.title =
    "Neigt die Welt beim Fliegen leicht nach unten, damit der Nacken entspannter bleibt. " +
    "Wirkt nur im Headset, nicht im normalen Web.";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "cf-slider";
  slider.min = "0";
  slider.max = String(MAX_WORLD_TILT_DEG);
  slider.step = "1";
  slider.value = String(Math.round(opts.initialTiltDeg));

  const readout = document.createElement("span");
  readout.className = "cf-readout";
  const render = (deg: number): void => {
    readout.textContent = `${deg}°`;
  };
  render(Math.round(opts.initialTiltDeg));

  const onInput = (): void => {
    const deg = Number(slider.value);
    render(deg);
    opts.onTiltChange(deg);
  };
  slider.addEventListener("input", onInput);

  row.append(label, slider, readout);
  root.append(row);

  return {
    element: root,
    dispose(): void {
      slider.removeEventListener("input", onInput);
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
.cf-root { display: flex; flex-direction: column; gap: 6px; }
.cf-root .devc-h3 { margin: 0 0 2px; }
.cf-row {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 8px;
  font-size: 11px; color: #a1a1aa;
}
.cf-label { grid-column: 1 / -1; }
.cf-slider { width: 100%; accent-color: #38bdf8; }
.cf-readout { font-variant-numeric: tabular-nums; color: #e4e4e7; min-width: 30px; text-align: right; }
`;
