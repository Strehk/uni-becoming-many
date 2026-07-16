/* becoming many · ui/app.js
   Aufbau der App: Atem-Band, Welt-Leiste, Layer-Karten (kompakt),
   Sinn-Auswahl-Sheet und der ERWEITERTE MODUS pro Layer (Vollbild):
   Herangehensweisen-Wechsel, großes Pad, Tiefen-Regler, Wanderstimme. */

import { SCALES } from "../core/engine.js";
import { SENSES, senseById } from "../senses/registry.js";
import { SenseLayer } from "../core/layer.js";
import { SpatialAudio } from "../core/spatial.js";
import { CHORD_PALETTE } from "../core/chords.js";
import { Knob, XYPad } from "./widgets.js";
import { FlightModule } from "../flight/module.js";
import { FlightMap, ORT_QUELLEN, ortHasDistance } from "../flight/mapping.js";
import { loadLayout, applyLayout, toggleLayoutPanel } from "./settings.js";
import { MasterModule } from "./master.js";
import { LfoModule } from "./lfo.js";
import { Ports } from "../patch/ports.js";
import { Cables } from "../patch/cables.js";
import { openMappingPopover } from "../patch/popover.js";

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

const RASTER = ["16n", "8n", "4n", "2n", "1n"];

/* Die Layer, die Becoming Many beim ersten Start anlegt. KEINE Kabel mehr —
   die Verbindungen (sinn → pegel, flug → pad …) steckt man von Hand. */
const BM_DEFAULT_SYNTHS = [
  "luft", "echo", "motion", "infrarot", "licht",
  "magnet", "rhythmus", "sicht", "chemie",
];

/* Sinn-Gate: je Karte wählbare Quelle, die die Karte an-/ausschaltet. Der Wert
   (value) ist entweder ein Schlüssel aus window.__bmFrame.senses oder ein
   Sonderwort ("immer" = immer an, "aus" = immer aus). Sinne heißen dort
   sinn_<id>, die Dramaturgie-Signale unrest/intensity/quality heißen schlicht. */
const GATE_OPTIONS = [
  { value: "immer",           label: "immer an" },
  { value: "aus",             label: "aus" },
  { value: "sinn_farben",     label: "farben" },
  { value: "sinn_echo",       label: "echo" },
  { value: "sinn_infrarot",   label: "infrarot" },
  { value: "sinn_uv",         label: "uv" },
  { value: "sinn_duft",       label: "duft" },
  { value: "sinn_netzwerk",   label: "netzwerk" },
  { value: "sinn_motion",     label: "motion" },
  { value: "sinn_magnetfeld", label: "magnetfeld" },
  { value: "sinn_rundum",     label: "rundum" },
  { value: "unrest",          label: "unrest" },
  { value: "intensity",       label: "intensity" },
  { value: "quality",         label: "quality" },
];

/* Drift-Lanes, falls das Modul beim Serialisieren noch nie geöffnet wurde —
   spiegelt die Startwerte aus LfoModule.buildCard (Reihenfolge lfo_a/b/c). */
const DEFAULT_LFO_STATE = [
  { form: "sinus",   tempo: 0.45 },
  { form: "zufall",  tempo: 0.62 },
  { form: "dreieck", tempo: 0.3 },
];

export class App {
  constructor(engine, savedState = null) {
    this.engine = engine;
    this.savedState = savedState;   // committed state.json (oder null) — siehe ensureBecomingManyDefaults
    this.layers = [];   // { layer, card, pad }
    this.overlay = null;
    this.root = document.getElementById("app");
    this.flightMap = new FlightMap(this);   // Backend für Kabel UND Sheet
    this.build();
    Cables.init(this, this.flightMap);
    requestAnimationFrame(() => this.frame());
  }

  /* ---------- Grundgerüst ---------- */
  build() {
    const head = h("header", "top");
    const brandRow = h("div", "brand-row");
    brandRow.append(
      h("div", "brand", "<b>becoming many</b> · drone organ"),
      this.countEl = h("div", "layer-count", "0 sinne"),
    );
    this.breath = h("canvas");
    this.breath.id = "breath";
    head.append(brandRow, this.breath);

    const world = h("div", "world");
    // Refs behalten: die Welt-Werte (Grundton one-way name→midi, Puls auf dem
    // Transport, Master am Gain) sind aus der Engine nicht sauber rücklesbar —
    // die <select>/<input> sind die Quelle der Wahrheit für serializeState().
    const rootWrap  = this.select("grundton", ["E1","A1","C2","D2","E2","G2","A2"], "A2", v => this.engine.setRoot(v));
    const scaleWrap = this.select("skala", Object.keys(SCALES), this.engine.world.scaleName, v => this.engine.setScale(v));
    const pulseWrap = this.select("puls", ["36","46","54","66","80"], "54", v => this.engine.setPulse(+v));
    this.rootSel = rootWrap.querySelector("select");
    this.scaleSel = scaleWrap.querySelector("select");
    this.pulseSel = pulseWrap.querySelector("select");
    world.append(rootWrap, scaleWrap, pulseWrap);

    this.rack = h("main"); this.rack.id = "rack";
    this.list = h("div"); this.list.id = "layers";
    this.empty = h("div", "empty-hint",
      "noch keine wahrnehmung aktiv.<br>füge unten den ersten sinn hinzu —<br>und dann immer mehr.");
    this.list.append(this.empty);
    this.rack.append(this.list);
    const lay = loadLayout();
    applyLayout(this.list, lay);
    SpatialAudio.setModel(lay.hrtf ? "HRTF" : "equalpower");

    const bar = h("footer", "bar");
    const vol = document.createElement("input");
    vol.type = "range"; vol.id = "master";
    vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = 0.8;
    vol.addEventListener("input", () => this.engine.setMasterVolume(+vol.value));
    this.masterInput = vol;
    const fly = h("button", null, "✈");
    fly.id = "fly-btn";
    fly.title = "flugmodus";
    fly.addEventListener("click", () => FlightModule.toggle(this));
    const lfo = h("button", null, "∿");
    lfo.id = "lfo-btn";
    lfo.title = "drift-modul";
    lfo.addEventListener("click", () => LfoModule.toggle(this));
    const mst = h("button", null, "≣");
    mst.id = "master-btn";
    mst.title = "master-modul";
    mst.addEventListener("click", () => MasterModule.toggle(this));
    const cfg = h("button", null, "⚙");
    cfg.id = "settings-btn";
    cfg.title = "ansicht";
    cfg.addEventListener("click", () => toggleLayoutPanel(this));
    const add = h("button", null, "+ sinn");
    add.id = "add-btn";
    add.addEventListener("click", () => this.openSheet());
    bar.append(vol, lfo, mst, cfg, fly, add);

    // Nur in der Entwicklung: die aktuelle Komposition als state.json exportieren
    // (Theatre-Manier — Datei ins Repo legen & committen). import.meta.env.DEV
    // wird von Vite im Prod-Build zu false → der Button fällt komplett weg.
    if (import.meta.env.DEV) {
      const save = h("button", null, "⤓");
      save.id = "save-btn";
      save.title = "Komposition als state.json exportieren";
      save.addEventListener("click", () => this.downloadState());
      bar.append(save);
    }

    this.root.append(head, world, this.rack, bar);
  }

  select(label, opts, val, onChange) {
    const wrap = h("label", null, `<span>${label}</span>`);
    const sel = document.createElement("select");
    opts.forEach(o => {
      const op = document.createElement("option");
      op.value = o; op.textContent = o;
      if (o === val) op.selected = true;
      sel.append(op);
    });
    sel.addEventListener("change", () => onChange(sel.value));
    wrap.append(sel);
    return wrap;
  }

  /* ---------- Sinn-Auswahl ---------- */
  openSheet() {
    const veil = h("div"); veil.id = "sheet-veil";
    const sheet = h("div"); sheet.id = "sheet";
    sheet.append(h("div", "sheet-grip"), h("div", "sheet-title", "wahrnehmung hinzufügen"));
    SENSES.forEach(s => {
      const n = this.layers.filter(x => x.layer.sense.id === s.id).length;
      const item = h("button", "sense-item");
      item.style.setProperty("--c", s.color);
      item.innerHTML = `
        <span class="dot"></span>
        <span><div class="s-name">${s.name}</div><div class="s-desc">${s.desc}</div></span>
        ${n ? `<span class="s-count">×${n}</span>` : ""}`;
      item.addEventListener("click", () => { close(); this.addLayer(s.id); });
      sheet.append(item);
    });
    const close = () => { veil.remove(); sheet.remove(); };
    veil.addEventListener("click", close);
    document.body.append(veil, sheet);
  }

  /* ---------- Layer ---------- */
  addLayer(senseId, variantIdx = 0) {
    const sense = senseById(senseId);
    if (!sense) return null;
    const layer = new SenseLayer(sense, this.engine, variantIdx);
    layer.gate = "immer";   // Sinn-Gate: standardmäßig immer an (siehe frame())
    const card = h("div", "card");
    card.style.setProperty("--c", sense.color);
    const info = { layer, card, pad: null };
    this.fillCard(info);
    this.empty.remove();
    this.list.append(card);
    this.layers.push(info);
    this.updateCount();
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return info;
  }

  setLayerMuted(info, muted) {
    const { layer, card } = info;
    if (layer.muted !== muted) layer.toggleMute();
    card.classList.toggle("muted", layer.muted);
    const muteBtn = card.querySelector(".card-head .icon-btn[title='stummschalten']");
    if (muteBtn) muteBtn.classList.toggle("on", !layer.muted);
  }

  /* Früher schaltete der Host hierüber die Karten fest nach Sinn-Zuordnung.
     Jetzt besitzt jede Karte ein eigenes, wählbares Gate (layer.gate), das in
     frame() ausgewertet wird — deshalb ist dies ein No-op. Die Methode bleibt
     bestehen, damit der Host-Zweig `if (app.syncSenseLayers)` weiterhin greift
     und NICHT ersatzweise Layer nachlädt. */
  syncSenseLayers(_synthId, _value) {}

  /* Sinn-Gate: jede Karte an-/ausschalten nach ihrer gewählten Quelle
     (window.__bmFrame.senses). Läuft im eigenen frame() UND — wichtig — vom
     Host (pumpFromHost), damit Layer auch bei geschlossenem Reiter anspringen. */
  applySenseGates() {
    const gsrc = (window.__bmFrame && window.__bmFrame.senses) || null;
    for (const info of this.layers) {
      const g = info.layer.gate;
      let on;
      if (g === "immer" || !g) on = true;
      else if (g === "aus")   on = false;             // hartes Aus, ignoriert Signale
      else on = gsrc ? (gsrc[g] || 0) > 0.5 : false;  // ohne Host-Frame: gegatete Karten aus
      this.setLayerMuted(info, !on);
    }
  }

  /* Vom Host jede Frame aufgerufen, SOLANGE der Synth-Reiter zu ist: dann ist
     der iframe display:none und BEIDE eigenen rAF-Schleifen (App.frame() und
     FlightModule.runLoop) pausieren. Damit der Synth wie eingestellt weiterspielt
     — Module springen an, Modulationen greifen, gebundene Sinne sitzen an ihren
     Orten — werden hier alle KLANG-relevanten Teile von frame() nachgezogen;
     nur das Zeichnen (Wellen, Pads, Kabel) entfällt. Spiegelt frame(). */
  pumpFromHost() {
    // Flug-Welt aus dem Host-Frame auffrischen (sonst friert sie mit runLoop ein).
    if (FlightModule.active && FlightModule.world) FlightModule.world.update();

    // Live-Quellen (Flug, Drift, Sinne) einsammeln und Zuordnungen anwenden.
    const live = {};
    if (FlightModule.active && FlightModule.world) Object.assign(live, FlightModule.world.params);
    if (LfoModule.active) { LfoModule.frame(); Object.assign(live, LfoModule.params); }
    if (window.__bmFrame && window.__bmFrame.senses) Object.assign(live, window.__bmFrame.senses);
    this.flightMap.apply(live);

    // Sinn-Gate (Module an-/ausschalten).
    this.applySenseGates();

    // Räumliches Hören: Panner an die Anker, sonst heim zum Hörer.
    const W = (FlightModule.active && FlightModule.world && FlightModule.world.pos)
      ? FlightModule.world : null;
    SpatialAudio.frame(
      W ? { x: W.pos.x, y: W.pos.y, z: W.pos.z, yaw: W.yaw, pitch: W.pitch } : null,
      W ? W.anchors : null,
      this.flightMap.spatialBindings());
  }

  /* Erster Aufbau (einmalig, beide Boot-Pfade laufen hier durch). Liegt eine
     komponierte state.json vor, wird sie geladen; sonst greifen die fest
     verdrahteten (kabellosen) Standard-Layer. */
  ensureBecomingManyDefaults() {
    if (this._bmDefaultsReady) return;
    this._bmDefaultsReady = true;

    const saved = this.savedState;
    if (saved && Array.isArray(saved.layers) && saved.layers.length) {
      this.loadState(saved);
    } else {
      for (const synth of BM_DEFAULT_SYNTHS) {
        if (!this.layers.some(info => info.layer.sense.id === synth)) {
          this.addLayer(synth);
        }
      }

      for (const info of this.layers) {
        const layer = info.layer;
        layer.setVolume(0.68);
        layer.setRoom(0.34);
        layer.setCut(0.9);
        this.setLayerMuted(info, true);
      }

      if (!FlightModule.active) FlightModule.open(this);
    }

    // Standard: EIN Luft·Chor-Layer, an ALLE Orte gebunden.
    this.ensureAllOrteChorLayer();
    this.flightMap.emit();
  }

  /* Standard-Verbindung: einen Luft·Chor-Layer anlegen und an "alle orte"
     binden (EINE Bindung) — die räumliche Grund-Stimme der Welt. Nur, wenn noch
     kein Layer an "alle" hängt (bewusst geladene Zustände bleiben unangetastet).
     Gate/Regler wie zuvor der Duft-Layer, damit er mit dem Duft-Sinn angeht. */
  ensureAllOrteChorLayer() {
    if (this.flightMap.list.some(m => m.control === "ort" && m.quelle === "alle")) return;
    const info = this.addLayer("luft", 3);   // 3 = Chor-Variante der Luft
    if (!info) return;
    info.layer.gate = "sinn_duft";
    info.layer.setVolume(0.68);
    info.layer.setRoom(0.34);
    info.layer.setCut(0.9);
    this.setLayerMuted(info, true);          // startet stumm, Gate schaltet frei
    this.flightMap.add(info.layer.id + "|ort", "alle");
    this.fillCard(info);
  }

  /* ---------- Komposition speichern / laden (Theatre-Manier) ---------- */

  /* Die lebende Komposition als schlichtes JSON-Objekt — Welt, Master-FX,
     Layer (Sinn/Variante/Regler), Kabel und Drift-Lanes. Kabel referenzieren
     ihr Ziel-Layer über den ARRAY-INDEX, nicht die flüchtige "L#"-Id. */
  serializeState() {
    const idIndex = new Map();
    this.layers.forEach((info, i) => idIndex.set(info.layer.id, i));

    const layers = this.layers.map(info => {
      const L = info.layer;
      return {
        sense: L.sense.id,
        variant: L.variantIdx,
        muted: L.muted,
        gate: L.gate,
        volume: L.volume,
        room: L.roomVal,
        cut: L.cutVal,
        macro: L.macroVal,
        melody: L.melodyVal,
        xy: L.xy ? [L.xy[0], L.xy[1]] : [0.5, 0.5],
        params: (L.paramVals || []).slice(),
      };
    });

    const cables = [];
    for (const m of this.flightMap.list) {
      const layer = m.layerId === "master" ? "master" : idIndex.get(m.layerId);
      if (layer === undefined) continue;   // Kabel auf ein nicht mehr existentes Layer
      const c = {
        quelle: m.quelle, layer, control: m.control,
        min: m.min, max: m.max, staerke: m.staerke, glatt: m.glatt, kurve: m.kurve,
      };
      if (m.spatial) c.spatial = { ref: m.spatial.ref, roll: m.spatial.roll };
      cables.push(c);
    }

    const lanes = LfoModule.lanes || DEFAULT_LFO_STATE;
    const lfo = lanes.map(l => ({ form: l.form, tempo: l.tempo }));

    return {
      version: 1,
      world: {
        root: this.rootSel ? this.rootSel.value : "A2",
        scale: this.scaleSel ? this.scaleSel.value : this.engine.world.scaleName,
        pulse: this.pulseSel ? +this.pulseSel.value : 54,
        master: this.masterInput ? +this.masterInput.value : 0.8,
      },
      fx: { ...this.engine.fx },
      layers,
      cables,
      lfo,
    };
  }

  /* Komposition aus einem serialisierten Zustand aufbauen. Reihenfolge zählt:
     Welt/FX → Layer (Variante VOR Regler-Werten) → Kabel (neu verzeigert) → Drift. */
  loadState(state) {
    const w = state.world || {};
    if (w.root != null)   { this.engine.setRoot(w.root);          if (this.rootSel)  this.rootSel.value = w.root; }
    if (w.scale != null)  { this.engine.setScale(w.scale);        if (this.scaleSel) this.scaleSel.value = w.scale; }
    if (w.pulse != null)  { this.engine.setPulse(+w.pulse);       if (this.pulseSel) this.pulseSel.value = String(w.pulse); }
    if (w.master != null) { this.engine.setMasterVolume(+w.master); if (this.masterInput) this.masterInput.value = String(w.master); }

    const fx = state.fx || {};
    if (fx.eqlow != null)  this.engine.setEq("low", fx.eqlow);
    if (fx.eqmid != null)  this.engine.setEq("mid", fx.eqmid);
    if (fx.eqhigh != null) this.engine.setEq("high", fx.eqhigh);
    if (fx.filter != null) this.engine.setFilterCutoff(fx.filter);
    // Delay bleibt lazy: nur anlegen, wenn wirklich ein Anteil gespeichert ist.
    if (fx.delaymix != null && fx.delaymix > 0) {
      this.engine.setDelayMix(fx.delaymix);
      if (fx.delaytime != null) this.engine.setDelayTime(fx.delaytime);
      if (fx.delayfb != null)   this.engine.setDelayFeedback(fx.delayfb);
    }

    // Layer — mit Variante synchron bauen (first=true), dann Werte VARIANTE-ZUERST.
    const newIds = [];
    for (const ls of (state.layers || [])) {
      const info = this.addLayer(ls.sense, ls.variant || 0);
      if (!info) { newIds.push(null); continue; }
      const L = info.layer;
      if (Array.isArray(ls.params)) ls.params.forEach((v, i) => L.setParam(i, v));
      if (ls.macro != null)  L.setMacro(ls.macro);
      if (ls.melody != null) L.setMelody(ls.melody);
      if (Array.isArray(ls.xy)) L.setXY(ls.xy[0], ls.xy[1]);
      if (ls.volume != null) L.setVolume(ls.volume);
      if (ls.room != null)   L.setRoom(ls.room);
      if (ls.cut != null)    L.setCut(ls.cut);
      if (ls.gate != null)   L.gate = ls.gate;   // sonst greift der addLayer-Standard "immer"
      this.setLayerMuted(info, !!ls.muted);
      this.fillCard(info);   // Karte neu befüllen → Regler zeigen die geladenen Werte
      newIds.push(L.id);
    }

    // Kabel — Ziel-Layer per Index auf die frischen Ids umzeigen.
    for (const c of (state.cables || [])) {
      const layerId = c.layer === "master" ? "master" : newIds[c.layer];
      if (layerId == null) continue;
      const m = this.flightMap.add(`${layerId}|${c.control}`, c.quelle);
      if (!m) continue;   // z. B. Spatial/Ort-Nichtübereinstimmung
      if (c.min != null)     m.min = c.min;
      if (c.max != null)     m.max = c.max;
      if (c.staerke != null) m.staerke = c.staerke;
      if (c.glatt != null)   m.glatt = c.glatt;
      if (c.kurve != null)   m.kurve = c.kurve;
      if (c.spatial && m.spatial) { m.spatial.ref = c.spatial.ref; m.spatial.roll = c.spatial.roll; }
    }

    // Karten neu befüllen, damit die Ort-Dropdowns die eben geladenen
    // Ort-Bindungen zeigen (die Kabel entstanden erst NACH dem ersten fillCard).
    this.layers.forEach(info => this.fillCard(info));

    if (Array.isArray(state.lfo)) LfoModule.applyState(state.lfo);

    if (!FlightModule.active) FlightModule.open(this);
    this.flightMap.emit();
  }

  /* Dev-Export: serialisieren und als state.json herunterladen. */
  downloadState() {
    const json = JSON.stringify(this.serializeState(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "state.json";
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* Zeigt die kompakte Karte diesen Regler? layer.shown pflegt der
     erweiterte Modus (Checkbox pro Regler); ohne Eintrag gilt der
     Standard: alles außer Klang-Inneres (param0..n). */
  isShown(layer, control) {
    const s = layer.shown || {};
    return s[control] != null ? s[control] : !control.startsWith("param");
  }

  /* Eingangs-Buchse eines Ziels — sitzt DIREKT am Regler (bzw. an der
     Pad-Achse / im Karten-Kopf). fillCard baut Karten komplett neu
     (Varianten-Wechsel!), daher werden Ports dort ab- und neu angemeldet. */
  makeJack(layer, control, label) {
    const jack = h("div", "port in");
    if (control === "ort") jack.classList.add("ort");
    jack.style.setProperty("--pc", layer.sense.color);
    jack.dataset.target = layer.id + "|" + control;
    // Tippen auf eine belegte Buchse öffnet die Einstellungen des Kabels
    jack.addEventListener("pointerdown", (e) => {
      const m = this.flightMap.list.find(x => x.layerId === layer.id && x.control === control);
      if (m) { e.stopPropagation(); openMappingPopover(this.flightMap, m, e.clientX, e.clientY); }
    });
    Ports.register({
      id: layer.id + "|in|" + control,
      dir: "in", el: jack, color: layer.sense.color, label,
    });
    return jack;
  }

  /* Karte (neu) befüllen — auch nach Varianten-Wechsel oder Overlay-Schluss. */
  fillCard(info) {
    const { layer, card } = info;
    const v = layer.variant;
    card.innerHTML = "";
    card.classList.toggle("muted", layer.muted);
    Ports.unregister(layer.id + "|");

    const head = h("div", "card-head");
    const moreBtn = h("button", "icon-btn", "⋯");
    moreBtn.title = "erweiterter modus";
    moreBtn.addEventListener("click", () => this.openExtended(info));
    const muteBtn = h("button", "icon-btn" + (layer.muted ? "" : " on"), "●");
    muteBtn.title = "stummschalten";
    muteBtn.addEventListener("click", () => {
      const m = layer.toggleMute();
      card.classList.toggle("muted", m);
      muteBtn.classList.toggle("on", !m);
    });
    const delBtn = h("button", "icon-btn", "×");
    delBtn.title = "sinn entfernen";
    delBtn.addEventListener("click", () => this.removeLayer(info));
    head.append(
      h("span", "dot"),
      h("div", "card-title",
        `<div class="name">${layer.sense.name} <span class="variant-tag">· ${v.name}</span></div>
         <div class="sub">${v.desc}</div>`),
      moreBtn, muteBtn, delBtn,
    );

    info.pad = new XYPad({
      color: layer.sense.color,
      senseId: layer.sense.id,
      labels: v.xyLabels,
      value: layer.xy || v.xyDefault || [0.5, 0.5],
      onChange: (x, y) => layer.setXY(x, y),
    });
    // Pad-Buchsen direkt an den Achsen-Beschriftungen
    const spans = info.pad.el.querySelectorAll(".pad-labels span");
    spans[0].prepend(this.makeJack(layer, "padx", "↔ " + v.xyLabels[0]));
    spans[1].append(this.makeJack(layer, "pady", "↕ " + v.xyLabels[1]));

    const knobs = h("div", "knob-row");
    const mk = (control, opts) => {
      const k = new Knob({ color: layer.sense.color, ...opts });
      k.el.append(this.makeJack(layer, control, opts.label));
      knobs.append(k.el);
      return k;
    };
    if (this.isShown(layer, "pegel"))
      mk("pegel", { label: "pegel", value: layer.volume, onChange: x => layer.setVolume(x) });
    if (this.isShown(layer, "raum"))
      mk("raum", { label: "raum", value: layer.roomVal, onChange: x => layer.setRoom(x) });
    if (this.isShown(layer, "cutoff"))
      mk("cutoff", { label: "cutoff", value: layer.cutVal, onChange: x => layer.setCut(x) });
    if (layer.handle.macro && this.isShown(layer, "macro"))
      mk("macro", { label: layer.handle.macro.label, value: layer.macroVal, onChange: x => layer.setMacro(x) });
    if ((layer.gen || layer.chords || layer.motif || layer.turing) && this.isShown(layer, "melodie"))
      mk("melodie", { label: "melodie", value: layer.melodyVal, onChange: x => layer.setMelody(x) });
    // Klang-Inneres, das per Checkbox aufs Karten-Menü gewählt wurde
    (layer.handle.params || []).forEach((p, i) => {
      if (this.isShown(layer, "param" + i))
        mk("param" + i, { label: p.label, value: layer.paramVals[i], onChange: x => layer.setParam(i, x) });
    });

    // Sinn-Gate-Auswahl: welche Quelle diese Karte an-/ausschaltet (frame()).
    const gateWrap = h("label", "card-gate", `<span>sinn</span>`);
    const gateSel = document.createElement("select");
    GATE_OPTIONS.forEach(o => {
      const op = document.createElement("option");
      op.value = o.value; op.textContent = o.label;
      if (o.value === (layer.gate || "immer")) op.selected = true;
      gateSel.append(op);
    });
    gateSel.addEventListener("change", () => { layer.gate = gateSel.value; });
    gateWrap.append(gateSel);

    card.append(head, gateWrap, this.makeOrtSection(layer), info.pad.el, knobs);
  }

  /* Ort-Wahl per Dropdown (ersetzt das frühere Ort-Kabel): an welchen Duft-/
     Richtungs-Ankern diese Karte räumlich hört. MEHRERE Orte sind erlaubt —
     jede Bindung eine Zeile; die Audio-Seite (SpatialAudio) legt den Sinn an
     den jeweils NÄCHSTEN der gewählten Orte. Jede Bindung lebt wie zuvor als
     "ort"-Mapping in der FlightMap. */
  makeOrtSection(layer) {
    const wrap = h("div", "card-ort-wrap");
    wrap.style.setProperty("--c", layer.sense.color);
    const build = () => {
      wrap.innerHTML = "";
      const bindings = this.flightMap.list.filter(
        x => x.layerId === layer.id && x.control === "ort");
      bindings.forEach(m => wrap.append(this.ortRow(layer, m, build)));
      // "+ ort" — eine weitere Zeile; Aggregate ("alle orte", Kategorien) machen
      // Mehrfach-Zeilen meist überflüssig, daher kein Sammel-Knopf mehr.
      if (bindings.length < ORT_QUELLEN.length) {
        const used = new Set(bindings.map(m => m.quelle));
        const add = h("button", "fl-add ort-add", bindings.length ? "+ ort" : "+ ort wählen");
        add.addEventListener("click", () => {
          const free = ORT_QUELLEN.find(([v]) => !used.has(v));
          if (free && this.flightMap.add(layer.id + "|ort", free[0])) build();
        });
        wrap.append(add);
      }
    };
    build();
    return wrap;
  }

  /* Eine einzelne Ort-Zeile: Dropdown (welcher Ort) + Distanz-Regler daneben +
     löschen. `refresh` baut die ganze Ort-Sektion neu (Knobs/„+ ort"). */
  ortRow(layer, m, refresh) {
    const row = h("div", "card-ort", "<span>ort</span>");

    const sel = document.createElement("select");
    ORT_QUELLEN.forEach(([val, label]) => {
      const op = document.createElement("option");
      op.value = val; op.textContent = label;
      sel.append(op);
    });
    sel.value = m.quelle;
    sel.addEventListener("change", () => {
      // Dieselbe Quelle nicht zweimal am selben Sinn.
      const dup = this.flightMap.list.some(
        x => x !== m && x.layerId === layer.id && x.control === "ort" && x.quelle === sel.value);
      if (dup) { sel.value = m.quelle; return; }
      m.quelle = sel.value; this.flightMap.emit(); refresh();
    });

    // Distanz-Regler (Einzel-Düfte UND Aggregate; Kompass dämpft nie).
    const knobs = h("div", "knob-row wrap ort-knobs");
    if (ortHasDistance(m.quelle)) {
      if (!m.spatial) m.spatial = { ref: 0.15, roll: 0.45 };
      const mk = (label, value, onChange) => {
        const k = new Knob({ label, value, color: layer.sense.color, onChange });
        knobs.append(k.el);
      };
      mk("nah-radius", m.spatial.ref, v => { m.spatial.ref = v; });
      mk("abfall", m.spatial.roll, v => { m.spatial.roll = v; });
    }

    const del = h("button", "icon-btn ort-del", "×");
    del.title = "ort entfernen";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      this.flightMap.remove(m);
      refresh();
    });

    row.append(sel, knobs, del);
    return row;
  }

  removeLayer(info) {
    SpatialAudio.forget(info.layer);   // Panner entsorgt layer.dispose()
    info.layer.dispose();
    info.card.remove();
    this.layers = this.layers.filter(x => x !== info);
    Ports.unregister(info.layer.id + "|");
    this.flightMap.prune();
    this.updateCount();
    if (!this.layers.length && !FlightModule.active && !MasterModule.active) {
      this.list.append(this.empty);
    }
  }

  updateCount() {
    const n = this.layers.length;
    this.countEl.textContent = n === 1 ? "1 sinn" : `${n} sinne`;
  }

  /* ---------- Erweiterter Modus (Vollbild pro Layer) ---------- */
  openExtended(info) {
    this.closeExtended();
    const { layer } = info;
    const ov = h("div"); ov.id = "extended";
    ov.style.setProperty("--c", layer.sense.color);
    this.overlay = { el: ov, info, pad: null };
    this.renderExtended();
    document.body.append(ov);
  }

  closeExtended() {
    if (!this.overlay) return;
    this.fillCard(this.overlay.info);   // Karte spiegelt frische Werte
    this.overlay.el.remove();
    this.overlay = null;
  }

  renderExtended() {
    const ov = this.overlay.el;
    const info = this.overlay.info;
    const { layer } = info;
    const v = layer.variant;
    ov.innerHTML = "";

    // Gerüst: zentrierter Wrap; ab Desktop-Breite zwei Spalten —
    // links Pad + Klang, rechts Herangehensweise + Stimmen.
    const wrap = h("div", "ext-wrap");
    const body = h("div", "ext-body");
    const colL = h("div", "ext-col");
    const colR = h("div", "ext-col side");
    body.append(colL, colR);
    ov.append(wrap);

    // Kopf
    const head = h("div", "ext-head");
    const closeBtn = h("button", "icon-btn", "✕");
    closeBtn.addEventListener("click", () => this.closeExtended());
    head.append(
      h("div", "ext-title",
        `<span class="dot"></span> ${layer.sense.name} <span class="ext-sub">erweitert</span>`),
      closeBtn,
    );
    wrap.append(head, body);

    // Herangehensweisen — grundverschiedene musikalische Ansätze
    colR.append(h("div", "ext-section", "herangehensweise"));
    const chips = h("div", "chip-row");
    layer.sense.variants.forEach((vv, i) => {
      const c = h("button", "chip" + (i === layer.variantIdx ? " active" : ""),
        `<b>${vv.name}</b><small>${vv.desc}</small>`);
      c.addEventListener("click", () => {
        if (i === layer.variantIdx) return;
        layer.buildVariant(i, false);
        // Nach dem Wechsel Overlay & Karte neu zeichnen (Innenleben ist neu)
        setTimeout(() => { if (this.overlay) this.renderExtended(); this.fillCard(info); }, 350);
      });
      chips.append(c);
    });
    colR.append(chips);

    // Großes Pad
    const pad = new XYPad({
      color: layer.sense.color,
      senseId: layer.sense.id,
      labels: v.xyLabels,
      value: layer.xy || [0.5, 0.5],
      onChange: (x, y) => { layer.setXY(x, y); if (info.pad) info.pad.value = [x, y]; },
    });
    pad.cv.classList.add("xypad-big");
    this.overlay.pad = pad;
    colL.append(pad.el);

    // Hauptregler
    const knobRow1 = h("div", "knob-row wrap");
    const mk = (parent, opts) => { const k = new Knob({ color: layer.sense.color, ...opts }); parent.append(k.el); return k; };
    // Checkbox am Regler: steht er im allgemeinen Karten-Menü?
    // (Auswahl lebt als layer.shown, die Karte spiegelt sie sofort.)
    const chk = (k, control) => {
      const b = h("button", "k-show" + (this.isShown(layer, control) ? " on" : ""));
      b.title = "im karten-menü zeigen";
      b.addEventListener("click", () => {
        if (!layer.shown) layer.shown = {};
        layer.shown[control] = !this.isShown(layer, control);
        b.classList.toggle("on", layer.shown[control]);
        this.fillCard(info);
      });
      k.el.append(b);
      return k;
    };
    chk(mk(knobRow1, { label: "pegel", value: layer.volume, onChange: x => layer.setVolume(x) }), "pegel");
    chk(mk(knobRow1, { label: "raum",  value: layer.roomVal, onChange: x => layer.setRoom(x) }), "raum");
    chk(mk(knobRow1, { label: "cutoff", value: layer.cutVal, onChange: x => layer.setCut(x) }), "cutoff");
    if (layer.handle.macro) {
      chk(mk(knobRow1, { label: layer.handle.macro.label, value: layer.macroVal, onChange: x => layer.setMacro(x) }), "macro");
    }
    colL.append(knobRow1);

    // Tiefen-Parameter der Herangehensweise — per Checkbox auch aufs
    // Karten-Menü wählbar (dort patchbar als param0..n)
    if (layer.handle.params && layer.handle.params.length) {
      colL.append(h("div", "ext-section", "klang-inneres"));
      const row = h("div", "knob-row wrap");
      layer.handle.params.forEach((p, i) => {
        chk(mk(row, { label: p.label, value: layer.paramVals[i], onChange: x => layer.setParam(i, x) }), "param" + i);
      });
      colL.append(row);
    }

    // Wanderstimme (Melodie ohne Noten) — volle Kontrolle
    if (layer.gen) {
      colR.append(h("div", "ext-section", "wanderstimme"));
      const m = layer.gen.m;
      const row = h("div", "knob-row wrap");
      chk(mk(row, { label: "dichte", value: layer.melodyVal, onChange: x => layer.setMelody(x) }), "melodie");
      mk(row, { label: "lage", value: (m.baseOct || 0) / 4,
        onChange: x => { m.baseOct = Math.round(x * 4); } });
      mk(row, { label: "spielraum", value: ((m.octaves || 2) - 1) / 2,
        onChange: x => { m.octaves = 1 + Math.round(x * 2); } });
      mk(row, { label: "richtung", value: ((m.bias || 0) + 1) / 2,
        onChange: x => { m.bias = x * 2 - 1; } });
      mk(row, { label: "länge", value: 0.4,
        onChange: x => { m.dur = 0.08 + x * 5; } });
      colR.append(row);

      const rasterWrap = h("div", "world ext-raster");
      const curRaster = typeof layer.gen.loop.interval === "string" ? layer.gen.loop.interval : "4n";
      rasterWrap.append(this.select("schrittraster", RASTER,
        RASTER.includes(curRaster) ? curRaster : "4n",
        val => layer.gen.setInterval(val)));
      colR.append(rasterWrap);
    }

    // Motiv-Stimme — generative Melodien: Phrasen, Wiederholung, Variation
    if (layer.motif) {
      colR.append(h("div", "ext-section", "motiv-stimme"));
      const mm = layer.motif.m;
      const row = h("div", "knob-row wrap");
      chk(mk(row, { label: "dichte", value: layer.melodyVal, onChange: x => layer.setMelody(x) }), "melodie");
      mk(row, { label: "variation", value: layer.motif.variation,
        onChange: x => { layer.motif.variation = x; } });
      mk(row, { label: "phrase", value: ((mm.phraseLen || 5) - 3) / 4,
        onChange: x => { mm.phraseLen = 3 + Math.round(x * 4); } });
      mk(row, { label: "atempause", value: layer.motif.restBase / 6,
        onChange: x => { layer.motif.restBase = Math.round(x * 6); } });
      mk(row, { label: "lage", value: (mm.baseOct || 3) / 5,
        onChange: x => { mm.baseOct = Math.round(x * 5); } });
      colR.append(row);
      const rw = h("div", "world ext-raster");
      const cur = typeof layer.motif.loop.interval === "string" ? layer.motif.loop.interval : "8n";
      rw.append(this.select("schrittraster", RASTER, RASTER.includes(cur) ? cur : "8n",
        val => layer.motif.setInterval(val)));
      colR.append(rw);
    }

    // Schleifen-Stimme — gelockte Zufallsschleife, die langsam mutiert
    if (layer.turing) {
      colR.append(h("div", "ext-section", "schleife"));
      const tm = layer.turing.m;
      const row = h("div", "knob-row wrap");
      chk(mk(row, { label: "dichte", value: layer.melodyVal, onChange: x => layer.setMelody(x) }), "melodie");
      mk(row, { label: "wandel", value: layer.turing.mutate,
        onChange: x => layer.turing.setMutate(x) });
      mk(row, { label: "länge", value: (layer.turing.len - 2) / 14,
        onChange: x => layer.turing.setLen(2 + x * 14) });
      mk(row, { label: "lage", value: (tm.baseOct || 2) / 4,
        onChange: x => { tm.baseOct = Math.round(x * 4); } });
      colR.append(row);
      const rw = h("div", "world ext-raster");
      const cur = typeof layer.turing.loop.interval === "string" ? layer.turing.loop.interval : "8n";
      rw.append(this.select("schrittraster", RASTER, RASTER.includes(cur) ? cur : "8n",
        val => layer.turing.setInterval(val)));
      colR.append(rw);
      const reroll = h("button", "pill", "⟳ neu würfeln");
      reroll.style.marginTop = "10px";
      reroll.addEventListener("click", () => layer.turing.reroll());
      colR.append(reroll);
    }

    // Akkordfolge — Melodien aus wählbaren Akkorden
    if (layer.chords) {
      colR.append(h("div", "ext-section", "akkordfolge"));
      const chipRow = h("div", "chord-chips");
      CHORD_PALETTE.forEach(c => {
        const b = h("button", "pill" + (layer.chords.sel.has(c.id) ? " active" : ""), c.label);
        b.addEventListener("click", () => {
          layer.chords.toggle(c.id);
          b.classList.toggle("active", layer.chords.sel.has(c.id));
        });
        chipRow.append(b);
      });
      colR.append(chipRow);

      const musterWrap = h("div", "world ext-raster");
      musterWrap.append(this.select("muster", ["auf", "ab", "pendel", "zufall", "block"],
        layer.chords.pattern, val => layer.chords.setPattern(val)));
      colR.append(musterWrap);

      const cm = layer.chords.m;
      const row = h("div", "knob-row wrap");
      chk(mk(row, { label: "dichte", value: layer.melodyVal, onChange: x => layer.setMelody(x) }), "melodie");
      mk(row, { label: "wechsel",
        value: Math.max(0, Math.min(1, (Number(layer.chords.wechselLoop.interval) - 2) / 14)),
        onChange: x => layer.chords.setWechsel(2 + x * 14) });
      mk(row, { label: "lage", value: (cm.baseOct || 2) / 4,
        onChange: x => { cm.baseOct = Math.round(x * 4); } });
      mk(row, { label: "länge", value: 0.3,
        onChange: x => { cm.dur = 0.08 + x * 4; } });
      mk(row, { label: "fülle", value: ((cm.octaves || 1) - 1) / 2,
        onChange: x => { cm.octaves = 1 + Math.round(x * 2); } });
      colR.append(row);
    }

    wrap.append(h("div", "ext-foot", "änderungen wirken sofort — einfach zuhören."));
  }

  /* ---------- Render-Loop ---------- */
  frame() {
    const cv = this.breath;
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (w) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(w * dpr), bh = Math.round(hh * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hh);
      const n = Math.max(this.layers.length, 1);
      for (let li = 0; li < n; li++) {
        const info = this.layers[li];
        // Jede Linie atmet mit IHREM Sinn — Wellenform des eigenen Layers,
        // nicht die Master-Summe (ohne Layer: stille Summe als Platzhalter).
        const data = info ? info.layer.wave.getValue() : this.engine.wave.getValue();
        const color = info ? info.layer.sense.color : "#2a3440";
        const lvl = info ? info.layer.level() : 0.05;
        const off = (li - (n - 1) / 2) * Math.min(10, 42 / n);

        // Auto-Verstärkung: die WellenFORM zählt, nicht die Roh-Amplitude.
        // Spitzenwert weich verfolgen (schnell rauf, langsam runter) und die
        // Linie darauf normieren; die Gesamtgröße wächst mit dem Signal und
        // sättigt, statt bei leisen Sinnen unsichtbar zu bleiben.
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i]);
          if (a > peak) peak = a;
        }
        const store = info || this;
        store._wavePeak = Math.max(peak, (store._wavePeak || 0) * 0.94);
        const p = Math.max(store._wavePeak, 0.02);
        // Platz bis zum Bandrand respektieren (Linien-Versatz eingerechnet)
        const ampMax = hh / 2 - Math.abs(off) - 2;
        const amp = ampMax * Math.min(1, Math.sqrt(p * 5));

        g.strokeStyle = color;
        g.globalAlpha = 0.25 + Math.min(lvl * 3, 0.75);
        g.lineWidth = 1.4;
        g.beginPath();
        const step = Math.max(1, Math.floor(data.length / 220));
        for (let i = 0, k = 0; i < data.length; i += step, k++) {
          const x = (i / (data.length - 1)) * w;
          const y = hh / 2 + off + (data[i] / p) * amp;
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    for (const { layer, pad } of this.layers) {
      if (pad) { pad.level = layer.level(); pad.draw(); }
    }
    if (this.overlay && this.overlay.pad) {
      this.overlay.pad.level = this.overlay.info.layer.level();
      this.overlay.pad.draw();
    }

    // Live-Quellen einsammeln (Flug, Drift) und Zuordnungen anwenden.
    // Inaktive Quellen fehlen im Objekt → ihre Kabel frieren ein.
    const live = {};
    if (FlightModule.active && FlightModule.world) Object.assign(live, FlightModule.world.params);
    if (LfoModule.active) { LfoModule.frame(); Object.assign(live, LfoModule.params); }
    // Sinnes-/Dramaturgie-Quellen aus Becoming Many (Integrations-Erweiterung):
    // der Host pusht sie in window.__bmFrame; ohne Host-Frame frieren sie ein.
    if (window.__bmFrame && window.__bmFrame.senses) Object.assign(live, window.__bmFrame.senses);
    this.flightMap.apply(live);

    // Sinn-Gate anwenden (jede Karte an-/ausschalten nach ihrer Quelle).
    this.applySenseGates();

    // Räumliches Hören: Hörer folgt der Kamera, gebundene Sinne sitzen an
    // ihren Ankern. Ohne Flug (pose null) gleiten die Panner heim.
    const W = (FlightModule.active && FlightModule.world && FlightModule.world.pos)
      ? FlightModule.world : null;
    SpatialAudio.frame(
      W ? { x: W.pos.x, y: W.pos.y, z: W.pos.z, yaw: W.yaw, pitch: W.pitch } : null,
      W ? W.anchors : null,
      this.flightMap.spatialBindings());
    if (W && W.anchors) for (const a of W.anchors) {
      const b = this.flightMap.list.find(m => m.control === "ort" && m.quelle === a.id);
      a.boundColor = b ? this.flightMap.colorOf(b.layerId) : null;
    }

    Cables.frame();
    requestAnimationFrame(() => this.frame());
  }
};
