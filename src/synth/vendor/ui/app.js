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
import { FlightMap } from "../flight/mapping.js";
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

export class App {
  constructor(engine) {
    this.engine = engine;
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
    world.append(
      this.select("grundton", ["E1","A1","C2","D2","E2","G2","A2"], "A2", v => this.engine.setRoot(v)),
      this.select("skala", Object.keys(SCALES), this.engine.world.scaleName, v => this.engine.setScale(v)),
      this.select("puls", ["36","46","54","66","80"], "54", v => this.engine.setPulse(+v)),
    );

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
  addLayer(senseId) {
    const sense = senseById(senseId);
    if (!sense) return null;
    const layer = new SenseLayer(sense, this.engine);
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

  syncSenseLayers(synthId, value) {
    const on = value > 0.001;
    for (const info of this.layers) {
      if (info.layer.sense.id === synthId) this.setLayerMuted(info, !on);
    }
  }

  ensureBecomingManyDefaults() {
    if (this._bmDefaultsReady) return;
    this._bmDefaultsReady = true;

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
    this.flightMap.emit();
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
    // Ort-Buchse (räumliche Bindung) gehört zu keinem Regler → Karten-Kopf
    const ortWrap = h("div", "port-wrap head-port");
    ortWrap.append(this.makeJack(layer, "ort", "ort"), h("div", "port-label", "ort"));
    head.append(
      h("span", "dot"),
      h("div", "card-title",
        `<div class="name">${layer.sense.name} <span class="variant-tag">· ${v.name}</span></div>
         <div class="sub">${v.desc}</div>`),
      ortWrap, moreBtn, muteBtn, delBtn,
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

    card.append(head, info.pad.el, knobs);
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
