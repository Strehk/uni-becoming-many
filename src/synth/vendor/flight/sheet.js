/* becoming many · flight/sheet.js
   Die Listen-Ansicht der Flug→Synth-Zuordnungen: ein Bottom-Sheet über
   der App. Existiert PARALLEL zu den Patch-Kabeln — beide operieren auf
   derselben FlightMap und halten sich über deren Emitter synchron.
   mappingRow() wird auch vom Kabel-Popover wiederverwendet. */

import { QUELLEN, FLIGHT_KURVEN, ORT_QUELLEN, ortHasDistance } from "./mapping.js";
import { Knob } from "../ui/widgets.js";

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

export function selectEl(opts, val, onChange) {
  const sel = document.createElement("select");
  opts.forEach(([v, label]) => {
    const op = document.createElement("option");
    op.value = v; op.textContent = label;
    if (v === val) op.selected = true;
    sel.append(op);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

/* Zeile einer ORTS-Bindung (control "ort"): Quelle → Ziel, dazu die
   Distanz-Knobs (nur Orts-Wolken — Kompass-Richtungen dämpfen nie).
   Die Werte liest SpatialAudio.frame() direkt aus m.spatial. */
function spatialRow(map, m) {
  const row = h("div", "fl-map");
  const color = map.colorOf(m.layerId);
  row.style.setProperty("--c", color);

  const selRow = h("div", "fl-selrow");
  // Quellen-Wechsel feuert den Emitter: Knob-Zeile und Kabel ziehen um.
  selRow.append(selectEl(ORT_QUELLEN, m.quelle, v => { m.quelle = v; map.emit(); }));
  selRow.append(h("span", "fl-arrow", "→"));
  const tOpts = map.ortTargets().map(t => [t.id, t.label]);
  selRow.append(selectEl(tOpts, m.layerId + "|" + m.control,
    v => { map.retarget(m, v); }));
  const del = h("button", "icon-btn", "×");
  del.addEventListener("click", () => map.remove(m));
  selRow.append(del);
  row.append(selRow);

  if (ortHasDistance(m.quelle)) {
    if (!m.spatial) m.spatial = { ref: 0.15, roll: 0.45 };
    const knobs = h("div", "knob-row wrap");
    const mk = (label, value, onChange) => {
      const k = new Knob({ label, value, color, onChange });
      knobs.append(k.el);
    };
    mk("nah-radius", m.spatial.ref, v => { m.spatial.ref = v; });
    mk("abfall", m.spatial.roll, v => { m.spatial.roll = v; });
    row.append(knobs);
  } else {
    row.append(h("div", "fl-selrow small",
      '<span class="fl-klabel">richtung · konstante entfernung</span>'));
  }
  return row;
}

/* Eine editierbare Zuordnungs-Zeile (Quelle → Ziel, min/max/stärke/glätte,
   Kurve, Löschen). Wird vom Sheet UND vom Kabel-Popover benutzt. */
export function mappingRow(map, m) {
  if (m.control === "ort") return spatialRow(map, m);
  const row = h("div", "fl-map");
  const color = map.colorOf(m.layerId);
  row.style.setProperty("--c", color);

  const selRow = h("div", "fl-selrow");
  selRow.append(selectEl(QUELLEN, m.quelle, v => { m.quelle = v; m.cur = null; }));
  selRow.append(h("span", "fl-arrow", "→"));
  const tOpts = map.targets().map(t => [t.id, t.label]);
  selRow.append(selectEl(tOpts, m.layerId + "|" + m.control,
    v => { map.retarget(m, v); }));
  const del = h("button", "icon-btn", "×");
  del.addEventListener("click", () => map.remove(m));
  selRow.append(del);
  row.append(selRow);

  const knobs = h("div", "knob-row wrap");
  const mk = (label, value, onChange) => {
    const k = new Knob({ label, value, color, onChange });
    knobs.append(k.el);
  };
  mk("min", m.min, v => { m.min = v; });
  mk("max", m.max, v => { m.max = v; });
  mk("stärke", m.staerke, v => { m.staerke = v; });
  mk("glätte", m.glatt, v => { m.glatt = v; });
  row.append(knobs);

  const kv = h("div", "fl-selrow small");
  kv.append(h("span", "fl-klabel", "kurve"));
  kv.append(selectEl(FLIGHT_KURVEN.map(k => [k, k]), m.kurve, v => { m.kurve = v; }));
  row.append(kv);
  return row;
}

export const MappingSheet = {
  toggle(map, opts) { this.el ? this.close() : this.open(map, opts); },

  open(map, { onEmpty } = {}) {
    this.map = map;
    this.veil = h("div"); this.veil.id = "sheet-veil";
    this.veil.addEventListener("click", () => this.close());
    const sh = this.el = h("div", "fl-sheet fixed");
    sh.append(h("div", "sheet-grip"), h("div", "sheet-title", "flug → synth"));
    this.rows = h("div");
    sh.append(this.rows);
    const add = h("button", "fl-add", "+ zuordnung");
    add.addEventListener("click", () => {
      if (!this.map.add() && onEmpty) onEmpty();
    });
    sh.append(add);
    this.unsub = map.on(() => this.refresh());
    this.refresh();
    document.body.append(this.veil, sh);
  },

  refresh() {
    if (!this.el) return;
    this.rows.innerHTML = "";
    this.map.list.forEach(m => this.rows.append(mappingRow(this.map, m)));
  },

  close() {
    if (this.unsub) this.unsub();
    if (this.veil) this.veil.remove();
    if (this.el) this.el.remove();
    this.el = this.veil = this.unsub = null;
  },
};
