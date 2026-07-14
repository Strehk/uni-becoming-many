/* becoming many · main.js
   Einstieg. Die App wird sofort aufgebaut; Audio-Start wird im Hintergrund
   versucht und bei der ersten normalen Interaktion nochmal resumet, falls der
   Browser Autoplay blockiert. Kein Aktivierungs-Schleier. */

import "./styles/base.css";
import "./styles/rack.css";
import "./styles/patch.css";
import { Engine } from "./core/engine.js";
import { App } from "./ui/app.js";
import { loadLayout, applyTheme } from "./ui/settings.js";
import savedState from "./state.json";   // committете Komposition (Theatre-Manier)

(() => {
  applyTheme(loadLayout());
  const appEl = document.getElementById("app");
  if (!appEl) {
    throw new Error("#app mount point not found");
  }

  const engine = new Engine();
  const app = new App(engine, savedState);
  app.ensureBecomingManyDefaults();
  window.bmApp = app;
  window.bmEngine = engine;

  const startAudio = () => {
    engine.start().catch((e) => console.warn("audio start blocked:", e));
  };
  window.bmStartAudio = startAudio;

  // Retry the unlock on every early gesture until the context is genuinely
  // running — a single blocked/raced attempt must not leave the page silent
  // until reload. Detached the moment audio is audible.
  const unlockEvents = ["pointerdown", "keydown", "touchend"];
  const tryStart = () => {
    if (engine.isAudible()) {
      for (const ev of unlockEvents) window.removeEventListener(ev, tryStart);
      return;
    }
    startAudio();
  };
  for (const ev of unlockEvents) window.addEventListener(ev, tryStart);
})();
