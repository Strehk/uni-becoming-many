// ── Becoming Many — Event Controls (dev GUI) ────────────────────
//
// A small test-trigger panel inside the C dev console: one button per
// registered timeline event, emitting `event:trigger {id}` — the exact same
// bus channel the Theatre timeline pulses fire, so a manual test exercises the
// full production path (anchor at the presenting camera, play, exit, hide).

import type { EventId } from "../events/ids.ts";
import type { Bus } from "../signals/index.ts";

const STYLE_ID = "devc-event-styles";

export interface EventControls {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createEventControls(
  bus: Bus,
  events: readonly { id: EventId; label: string }[],
): EventControls {
  injectStyles();

  const root = document.createElement("section");
  root.className = "devc-section ev-root";

  const heading = document.createElement("h3");
  heading.className = "devc-h3";
  heading.textContent = "Events";
  root.append(heading);

  for (const { id, label } of events) {
    const button = document.createElement("button");
    button.className = "ev-trigger";
    button.textContent = label;
    button.title = `Event "${id}" jetzt auslösen (wie ein Timeline-Puls)`;
    button.addEventListener("click", () => bus.emit("event:trigger", { id }));
    root.append(button);
  }

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
.ev-root { display: flex; flex-direction: column; gap: 6px; }
.ev-root .devc-h3 { margin: 0 0 2px; }
.ev-trigger {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 3px; color: #a1a1aa; font-size: 11px; padding: 5px 8px; cursor: pointer;
  font-family: inherit; text-align: left;
}
.ev-trigger:hover { color: #38bdf8; border-color: #38bdf8; }
.ev-trigger:active { background: rgba(56,189,248,0.12); }
`;
