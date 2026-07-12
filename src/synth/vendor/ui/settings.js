/* becoming many · ui/settings.js
   Layout-Einstellungen: wie viele Module pro Reihe (auto/1..4) und
   Kompakt-Modus. Persistiert in localStorage ("bm.layout"), wirkt als
   data-cols-Attribut + .compact-Klasse auf #layers (siehe rack.css). */

import { SpatialAudio } from "../core/spatial.js";

const KEY = "bm.layout";
const DEFAULTS = { cols: "auto", compact: false, theme: "night", hrtf: false };

export function loadLayout() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch (e) { return { ...DEFAULTS }; }
}

export function saveLayout(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

export function applyLayout(listEl, s) {
  if (s.cols === "auto") listEl.removeAttribute("data-cols");
  else listEl.setAttribute("data-cols", s.cols);
  listEl.classList.toggle("compact", !!s.compact);
  applyTheme(s);
}

/* Night/Day — wirkt auf den Body (auch schon auf dem Start-Schleier). */
export function applyTheme(s) {
  const day = s.theme === "day";
  document.body.classList.toggle("day", day);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = day ? "#eef1f5" : "#07090d";
}

/* Kleines Popover über der Fußleiste; erneuter Klick schließt. */
export function toggleLayoutPanel(app) {
  const old = document.getElementById("settings-pop");
  if (old) { old.remove(); return; }

  const s = loadLayout();
  const pop = document.createElement("div");
  pop.id = "settings-pop";

  const title = document.createElement("div");
  title.className = "sheet-title";
  title.textContent = "ansicht";
  pop.append(title);

  // Module pro Reihe
  const world = document.createElement("div");
  world.className = "world";
  const wrap = document.createElement("label");
  wrap.innerHTML = "<span>module pro reihe</span>";
  const sel = document.createElement("select");
  [["auto", "auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]].forEach(([v, label]) => {
    const op = document.createElement("option");
    op.value = v; op.textContent = label;
    if (v === s.cols) op.selected = true;
    sel.append(op);
  });
  sel.addEventListener("change", () => {
    s.cols = sel.value;
    saveLayout(s); applyLayout(app.list, s);
  });
  wrap.append(sel);
  world.append(wrap);
  pop.append(world);

  // Kompakt-Modus
  const row = document.createElement("div");
  row.className = "toggle-row";
  row.append("kompakt");
  const tog = document.createElement("button");
  tog.className = "toggle" + (s.compact ? " on" : "");
  tog.addEventListener("click", () => {
    s.compact = !s.compact;
    tog.classList.toggle("on", s.compact);
    saveLayout(s); applyLayout(app.list, s);
  });
  row.append(tog);
  pop.append(row);

  // Night / Day
  const trow = document.createElement("div");
  trow.className = "toggle-row";
  trow.style.marginTop = "10px";
  trow.append("tag-modus");
  const ttog = document.createElement("button");
  ttog.className = "toggle" + (s.theme === "day" ? " on" : "");
  ttog.addEventListener("click", () => {
    s.theme = s.theme === "day" ? "night" : "day";
    ttog.classList.toggle("on", s.theme === "day");
    saveLayout(s); applyTheme(s);
  });
  trow.append(ttog);
  pop.append(trow);

  // Kopfhörer-3D (HRTF) — echtes räumliches Hören für Orts-Bindungen,
  // CPU-teurer als das Standard-Stereo (equalpower). Wirkt sofort.
  const hrow = document.createElement("div");
  hrow.className = "toggle-row";
  hrow.append("kopfhörer-3d (hrtf)");
  const htog = document.createElement("button");
  htog.className = "toggle" + (s.hrtf ? " on" : "");
  htog.addEventListener("click", () => {
    s.hrtf = !s.hrtf;
    htog.classList.toggle("on", s.hrtf);
    saveLayout(s);
    SpatialAudio.setModel(s.hrtf ? "HRTF" : "equalpower", app.layers);
  });
  hrow.append(htog);
  pop.append(hrow);

  document.body.append(pop);
}
