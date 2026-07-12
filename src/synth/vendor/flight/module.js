/* becoming many · flight/module.js — SIGNAL-QUELLE ALS MODUL IM RACK.
   (Integrations-Ersatz für die Demo-Flug-Karte: statt einer eigenen
   three-Welt zeigt die Karte die live vom Host — Becoming Many — gepushten
   Werte und bietet dieselben Ausgangs-Buchsen: die 6 Flugwerte, die
   Orts-/Richtungs-Quellen fürs räumliche Hören und neu die Sinnes-
   Intensitäten + Dramaturgie-Werte (unrest/intensity/quality).
   Der Vertrag nach außen ist unverändert: active, world, toggle/open/close. */

import { SignalWorld } from "./world.js";
import { MappingSheet } from "./sheet.js";
import { FLIGHT_QUELLEN, SENSE_QUELLEN, SPATIAL_QUELLEN, SPATIAL_FARBEN } from "./mapping.js";
import { Ports } from "../patch/ports.js";
import { Cables } from "../patch/cables.js";
import { MasterModule } from "../ui/master.js";

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

const SENSE_COLOR = "#9be87f";

const hostFlightCanvas = () => {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.__bmFlightCanvas ||
        window.parent.document.querySelector("#app > canvas");
    }
  } catch (e) {}
  return null;
};

export const FlightModule = {
  active: false,

  toggle(app) { this.active ? this.close() : this.open(app); },

  open(app) {
    this.app = app;
    this.map = app.flightMap;
    if (!this.world) this.world = new SignalWorld();
    if (!this.card) this.buildCard();
    app.empty.remove();
    app.list.prepend(this.card);
    this.registerPorts();
    this.active = true;
    this.syncFlyBtn();
    this.runLoop();
  },

  registerPorts() {
    Ports.unregister("flight|");
    FLIGHT_QUELLEN.forEach(([id, label]) => {
      Ports.register({ id: `flight|out|${id}`, dir: "out", el: this.portEls[id],
        color: "#7fd4e8", label });
    });
    SENSE_QUELLEN.forEach(([id, label]) => {
      Ports.register({ id: `flight|out|${id}`, dir: "out", el: this.portEls[id],
        color: SENSE_COLOR, label });
    });
    SPATIAL_QUELLEN.forEach(([id, label]) => {
      Ports.register({ id: `flight|out|${id}`, dir: "out", el: this.portEls[id],
        color: SPATIAL_FARBEN[id], label });
    });
  },

  close() {
    this.pauseLoop();
    MappingSheet.close();
    Ports.unregister("flight|");
    this.card.remove();
    this.active = false;
    this.syncFlyBtn();
    this.map.prune();
    this.app.layers.forEach(i => this.app.fillCard(i));
    MasterModule.syncKnobs();
    if (!this.app.layers.length && !MasterModule.active) {
      this.app.list.append(this.app.empty);
    }
  },

  syncFlyBtn() {
    const b = document.getElementById("fly-btn");
    if (b) b.classList.toggle("on", this.active);
  },

  /* ---------- Karte ---------- */
  buildCard() {
    const card = this.card = h("div", "card flight-card");
    card.style.setProperty("--c", "#7fd4e8");

    const head = h("div", "card-head");
    const closeBtn = h("button", "icon-btn", "×");
    closeBtn.title = "signale schließen";
    closeBtn.addEventListener("click", () => this.close());
    head.append(
      h("span", "dot"),
      h("div", "card-title",
        `<div class="name">Signale <span class="variant-tag">· becoming many</span></div>
         <div class="sub">flug & sinne der experience als quellen</div>`),
      closeBtn,
    );

    this.status = h("div", "fl-readout", "warte auf host-signale …");
    this.stage = h("div", "fl-stage");
    this.canvas = h("canvas");
    this.loading = h("div", "fl-loading", "keine live-vorschau");
    this.stage.append(this.canvas, this.loading);

    const hud = h("div", "fl-row");
    this.readout = h("div", "fl-readout", "—");
    this.mapBtn = h("button", "fl-btn accent", "→ synth");
    this.mapBtn.addEventListener("click", () =>
      MappingSheet.toggle(this.map, { onEmpty: () => {} }));
    hud.append(this.readout, this.mapBtn);

    this.portEls = {};
    const mkPorts = (list, color, extraCls) => {
      const row = h("div", `port-row${extraCls ? " " + extraCls : ""}`);
      list.forEach(([id, label]) => {
        const wrap = h("div", "port-wrap");
        wrap.style.setProperty("--pc", typeof color === "function" ? color(id) : color);
        const jack = h("div", "port out");
        Cables.bindOutPort(jack, `flight|out|${id}`, id,
          typeof color === "function" ? color(id) : color);
        wrap.append(jack, h("div", "port-label", label));
        row.append(wrap);
        this.portEls[id] = jack;
      });
      return row;
    };

    card.append(
      head,
      this.stage,
      this.status,
      hud,
      mkPorts(FLIGHT_QUELLEN, "#7fd4e8"),
      mkPorts(SENSE_QUELLEN, SENSE_COLOR),
      mkPorts(SPATIAL_QUELLEN, (id) => SPATIAL_FARBEN[id], "spatial"),
    );
  },

  /* ---------- Loop: Host-Frame übernehmen + Readout ---------- */
  runLoop() {
    this.pauseLoop();
    let acc = 0, last = performance.now();
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const t = performance.now();
      const dt = (t - last) / 1000; last = t;
      this.world.update();
      this.drawPreview();
      acc += dt;
      if (acc > 0.2) { acc = 0; this.updateReadout(); }
    };
    this._raf = requestAnimationFrame(tick);
  },

  pauseLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  updateReadout() {
    const p = this.world.params;
    this.status.textContent = this.world.hasFrame
      ? "verbunden mit becoming many"
      : "standalone — keine host-signale (werte eingefroren)";
    const deg = Math.round(p.richtung * 360);
    this.readout.innerHTML =
      `höhe <b>${Math.round(p.hoehe * 100)}</b> · ` +
      `tempo <b>${Math.round(p.tempo * 100)}</b> · ` +
      `nähe <b>${Math.round(p.naehe * 100)}</b> · ${deg}°` +
      (this.map.list.length ? ` · <span class="fl-live">${this.map.list.length}↦</span>` : "");
  },

  drawPreview() {
    const cv = this.canvas;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const hgt = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(hgt * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }

    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);

    const source = hostFlightCanvas();
    const validSource = source && source.width > 0 && source.height > 0;
    if (!validSource) {
      g.fillStyle = "#070b12";
      g.fillRect(0, 0, w, hgt);
      if (this.loading) this.loading.style.display = "";
      return;
    }

    const srcRatio = source.width / source.height;
    const dstRatio = w / hgt;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (srcRatio > dstRatio) {
      sw = source.height * dstRatio;
      sx = (source.width - sw) * 0.5;
    } else {
      sh = source.width / dstRatio;
      sy = (source.height - sh) * 0.5;
    }

    try {
      g.drawImage(source, sx, sy, sw, sh, 0, 0, w, hgt);
      if (this.loading) this.loading.style.display = "none";
    } catch (e) {
      g.fillStyle = "#070b12";
      g.fillRect(0, 0, w, hgt);
      if (this.loading) this.loading.style.display = "";
    }
  },
};
