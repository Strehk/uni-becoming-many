/* becoming many · ui/lfo.js
   Das DRIFT-Modul: drei freie, sehr langsame Modulatoren als Rack-Karte —
   die Ambient-Maschine. Jede Lane hat eine Wellenform (sinus, dreieck,
   zufall = weiches Wandern, stufen = sample & hold), ein Tempo (2 s bis
   4 min pro Runde) und eine Ausgangs-Buchse. Per Kabel auf beliebige
   Regler gesteckt (pegel, cutoff, pad, makro, master …) bewegt sich der
   Klang von selbst — Bereich und Stärke formt wie immer das Kabel.
   Die Werte rechnet App.frame() über frame(); solange das Modul offen
   ist, liegen sie als lfo_a/b/c im Live-Quellen-Mix der FlightMap. */

import { Knob } from "./widgets.js";
import { LFO_QUELLEN } from "../flight/mapping.js";
import { Ports } from "../patch/ports.js";
import { Cables } from "../patch/cables.js";

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

const FORMS = ["sinus", "dreieck", "zufall", "stufen"];
const LANE_COLORS = { lfo_a: "#8fd6a8", lfo_b: "#c9a8ff", lfo_c: "#ffce7a" };

/* Tempo-Knob (0..1) → Periode in Sekunden, logarithmisch 2 s … 240 s. */
const period = (v) => 2 * Math.pow(120, v);

export const LfoModule = {
  active: false,
  params: {},          // { lfo_a: 0..1, … } — gelesen von App.frame()
  lanes: null,

  toggle(app) { this.active ? this.close() : this.open(app); },

  open(app) {
    this.app = app;
    if (!this.card) this.buildCard();
    app.empty.remove();
    app.list.prepend(this.card);
    this.registerPorts();
    this.active = true;
    this._last = performance.now();
    this.syncBtn();
  },

  close() {
    Ports.unregister("lfo|");
    this.card.remove();
    this.active = false;
    this.syncBtn();
    if (!this.app.layers.length) this.app.list.append(this.app.empty);
  },

  syncBtn() {
    const b = document.getElementById("lfo-btn");
    if (b) b.classList.toggle("on", this.active);
  },

  registerPorts() {
    Ports.unregister("lfo|");
    this.lanes.forEach(l => {
      Ports.register({ id: `lfo|out|${l.id}`, dir: "out",
        el: l.jack, color: l.color, label: l.label });
    });
  },

  buildCard() {
    const card = this.card = h("div", "card lfo-card");
    card.style.setProperty("--c", "#8fd6a8");

    const head = h("div", "card-head");
    const closeBtn = h("button", "icon-btn", "×");
    closeBtn.title = "drift schließen";
    closeBtn.addEventListener("click", () => this.close());
    head.append(
      h("span", "dot"),
      h("div", "card-title",
        `<div class="name">Drift <span class="variant-tag">· quelle</span></div>
         <div class="sub">langsame wellen — der klang bewegt sich von selbst</div>`),
      closeBtn,
    );
    card.append(head);

    this.lanes = LFO_QUELLEN.map(([id, label], i) => {
      const lane = {
        id, label, color: LANE_COLORS[id],
        form: ["sinus", "zufall", "dreieck"][i],   // abwechslungsreiche Startformen
        tempo: [0.45, 0.62, 0.3][i],
        phase: Math.random(),                      // nicht alle synchron starten
        rndA: Math.random(), rndB: Math.random(),  // Stützpunkte für zufall/stufen
        value: 0.5,
      };
      this.params[id] = lane.value;

      const row = h("div", "lfo-lane");
      row.style.setProperty("--c", lane.color);

      const top = h("div", "lfo-lane-top");
      top.append(h("span", "lfo-name", label));
      const sel = document.createElement("select");
      FORMS.forEach(f => {
        const op = document.createElement("option");
        op.value = f; op.textContent = f;
        if (f === lane.form) op.selected = true;
        sel.append(op);
      });
      sel.addEventListener("change", () => { lane.form = sel.value; });
      top.append(sel);
      const tempoKnob = new Knob({ label: "tempo", value: lane.tempo,
        color: lane.color, onChange: v => { lane.tempo = v; } });
      top.append(tempoKnob.el);
      row.append(top);

      lane.cv = h("canvas", "lfo-viz");
      row.append(lane.cv);
      card.append(row);
      return lane;
    });

    // Ausgangs-Buchsen
    const ports = h("div", "port-row");
    this.lanes.forEach(l => {
      const wrap = h("div", "port-wrap");
      wrap.style.setProperty("--pc", l.color);
      const jack = h("div", "port out");
      Cables.bindOutPort(jack, `lfo|out|${l.id}`, l.id, l.color);
      wrap.append(jack, h("div", "port-label", l.label));
      ports.append(wrap);
      l.jack = jack;
    });
    card.append(ports);
  },

  /* Lane-Wert an Phase φ (0..1) — alle Formen liefern 0..1. */
  laneValue(l, phi) {
    switch (l.form) {
      case "dreieck": return phi < 0.5 ? phi * 2 : 2 - phi * 2;
      case "stufen":  return l.rndA;                       // hält bis zum Rundenende
      case "zufall": {                                     // weich zwischen Stützpunkten
        const t = phi * phi * (3 - 2 * phi);               // smoothstep
        return l.rndA + (l.rndB - l.rndA) * t;
      }
      default:        return 0.5 + 0.5 * Math.sin(phi * Math.PI * 2);  // sinus
    }
  },

  /* Pro Frame aus App.frame(): Phasen weiterdrehen, Werte + Anzeige. */
  frame() {
    const t = performance.now();
    const dt = Math.min(0.1, (t - (this._last || t)) / 1000);
    this._last = t;
    for (const l of this.lanes) {
      l.phase += dt / period(l.tempo);
      if (l.phase >= 1) {                       // neue Runde: Stützpunkte wandern
        l.phase %= 1;
        l.rndA = l.rndB;
        l.rndB = Math.random();
        if (l.form === "stufen") l.rndA = Math.random();
      }
      l.value = this.laneValue(l, l.phase);
      this.params[l.id] = l.value;
      this.drawLane(l);
    }
  },

  drawLane(l) {
    const cv = l.cv;
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(hh * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    // die Welle der Lane, einmal über die Breite …
    g.strokeStyle = l.color; g.globalAlpha = 0.55; g.lineWidth = 1.4;
    g.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const y = hh - 3 - this.laneValue(l, x / w) * (hh - 6);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    // … und der wandernde Punkt am aktuellen Wert
    const px = l.phase * w;
    const py = hh - 3 - l.value * (hh - 6);
    g.globalAlpha = 1; g.fillStyle = l.color;
    g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
  },
};
