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

(() => {
  applyTheme(loadLayout());
  const appEl = document.getElementById("app");
  if (!appEl) {
    throw new Error("#app mount point not found");
  }

  const engine = new Engine();
  const app = new App(engine);
  app.ensureBecomingManyDefaults();
  window.bmApp = app;
  window.bmEngine = engine;

  const startAudio = () => {
    engine.start().catch((e) => console.warn("audio start blocked:", e));
  };
  window.bmStartAudio = startAudio;
  window.addEventListener("pointerdown", startAudio, { once: true });
})();
