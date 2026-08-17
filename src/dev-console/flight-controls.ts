// ── Becoming Many — Flight Controls (dev GUI) ───────────────────
//
// Switches how the player moves, inside the C dev console. The configure screens arm free flight
// on their own (that is what they are for), so this panel is the override: go back to the piece's
// glider without leaving the configure mode, and pick which of the three look modes suits what you
// are doing — the pointer lock is closest to Minecraft, dragging keeps the cursor free for these
// very panels, the arrow keys need no mouse at all.
//
// Everything goes over the bus (`flight:mode`, `flight:look`) — the same channel main.ts uses when
// the interface mode arms free flight itself, so the buttons also mirror changes they did not make.

import type { LookMode } from "../player/free-flight.ts";
import type { Bus } from "../signals/index.ts";

const STYLE_ID = "devc-flight-styles";

export type FlightMode = "glide" | "free";

export interface FlightControls {
  readonly element: HTMLElement;
  dispose(): void;
}

const MODES: readonly { id: FlightMode; label: string; title: string }[] = [
  {
    id: "glide",
    label: "Gleiter",
    title: "Die Flugweise des Stücks: dauerhaft vorwärts, W/S steigen und sinken, A/D kurven",
  },
  {
    id: "free",
    label: "Freiflug",
    title:
      "Creative-Modus: W/A/S/D entlang der Blickrichtung, Space hoch, Shift runter, Strg schneller",
  },
];

const LOOKS: readonly { id: LookMode; label: string; title: string }[] = [
  {
    id: "pointerlock",
    label: "Pointer Lock",
    title: "Klick ins Bild fängt den Zeiger, ESC gibt ihn frei",
  },
  { id: "drag", label: "Maustaste", title: "Umsehen, solange eine Maustaste gehalten wird" },
  { id: "keys", label: "Tasten", title: "Umsehen mit den Pfeiltasten, ganz ohne Maus" },
];

export function createFlightControls(
  bus: Bus,
  initial: { mode: FlightMode; look: LookMode },
): FlightControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section fl-root";

  const heading = document.createElement("h3");
  heading.className = "devc-h3";
  heading.textContent = "Steuerung";
  root.append(heading);

  const modeButtons = new Map<FlightMode, HTMLButtonElement>();
  const lookButtons = new Map<LookMode, HTMLButtonElement>();

  const modeRow = row("Flugweise");
  for (const mode of MODES) {
    const button = choice(mode.label, mode.title, () => bus.emit("flight:mode", { mode: mode.id }));
    modeButtons.set(mode.id, button);
    modeRow.append(button);
  }

  const lookRow = row("Umsehen");
  for (const look of LOOKS) {
    const button = choice(look.label, look.title, () => bus.emit("flight:look", { mode: look.id }));
    lookButtons.set(look.id, button);
    lookRow.append(button);
  }

  const hint = document.createElement("p");
  hint.className = "fl-hint";
  hint.textContent = "Freiflug: W/A/S/D · Space hoch · Shift runter · Strg schneller · Pause mit K";

  root.append(modeRow, lookRow, hint);

  const markMode = (mode: FlightMode): void => {
    for (const [id, button] of modeButtons) button.classList.toggle("active", id === mode);
    lookRow.classList.toggle("fl-row--muted", mode !== "free");
  };
  const markLook = (look: LookMode): void => {
    for (const [id, button] of lookButtons) button.classList.toggle("active", id === look);
  };
  markMode(initial.mode);
  markLook(initial.look);

  // Reflect every change, including the ones the configure mode makes by itself.
  const offMode = bus.on("flight:mode", (payload) => {
    const mode = read(payload);
    if (mode === "glide" || mode === "free") markMode(mode);
  });
  const offLook = bus.on("flight:look", (payload) => {
    const mode = read(payload);
    if (mode === "pointerlock" || mode === "drag" || mode === "keys") markLook(mode);
  });

  return {
    element: root,
    dispose(): void {
      offMode();
      offLook();
      root.remove();
    },
  };
}

/** Narrow a `{ mode }` bus payload down to its string, or undefined. */
function read(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = new Map<string, unknown>(Object.entries(payload)).get("mode");
  return typeof value === "string" ? value : undefined;
}

function row(label: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "fl-row";
  const caption = document.createElement("span");
  caption.className = "fl-label";
  caption.textContent = label;
  element.append(caption);
  return element;
}

function choice(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fl-choice";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.fl-root { display: flex; flex-direction: column; gap: 6px; }
.fl-root .devc-h3 { margin: 0 0 2px; }
.fl-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.fl-row--muted { opacity: 0.45; }
.fl-label { flex: 0 0 62px; opacity: 0.75; }
.fl-choice {
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.fl-choice:hover { border-color: rgba(125, 211, 252, 0.75); }
.fl-choice.active { border-color: rgba(125, 211, 252, 0.9); color: #7fd4e8; }
.fl-hint { margin: 2px 0 0; opacity: 0.6; line-height: 1.4; }
`;
