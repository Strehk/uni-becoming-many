/* becoming many · flight/mapping.js
   Das Mapping-System: Flugparameter → Synth-Regler, präzise einstellbar.

   Jedes Mapping:
     quelle   – hoehe | tempo | kurve | neigung | naehe | richtung
     layerId + control – Ziel (pad-x, pad-y, pegel, raum, macro, melodie)
     min/max  – Zielbereich (min > max invertiert die Richtung)
     kurve    – Mathe der Übertragung: linear | sanft | exp | log | mitte
     staerke  – 0..1: wie weit sich der Regler vom Handwert wegbewegen darf
     glatt    – 0..1: Trägheit (glättet Zappeln, macht Übergänge weich)

   Der Handwert (base) wird beim Anlegen eingefroren; staerke blendet
   zwischen base und Flugwert — beim Löschen kehrt der Regler zu base zurück. */

export const FLIGHT_QUELLEN = [
  ["hoehe", "flughöhe"], ["tempo", "tempo"], ["kurve", "kurve"],
  ["neigung", "neigung"], ["naehe", "nähe zu objekten"], ["richtung", "kompasskurs"],
];
export const FLIGHT_KURVEN = ["linear", "sanft", "exp", "log", "mitte"];

/* Quellen des Drift-Moduls (3 freie LFOs). */
export const LFO_QUELLEN = [
  ["lfo_a", "drift a"], ["lfo_b", "drift b"], ["lfo_c", "drift c"],
];

/* Sinnes-Intensitäten + Dramaturgie-Werte aus Becoming Many (Integrations-
   Erweiterung): der Host pusht sie pro Frame; App.frame() mischt sie in den
   live-Mix, sobald ein Host-Frame existiert. Damit lässt sich z. B.
   "sinn echo → pegel des echo-layers" ganz normal verkabeln. */
export const SENSE_QUELLEN = [
  ["sinn_farben", "sinn farben"], ["sinn_echo", "sinn echo"],
  ["sinn_infrarot", "sinn infrarot"], ["sinn_uv", "sinn uv"],
  ["sinn_duft", "sinn duft"], ["sinn_netzwerk", "sinn netzwerk"],
  ["sinn_motion", "sinn motion"], ["sinn_magnetfeld", "sinn magnetfeld"],
  ["sinn_rundum", "sinn rundum"],
  ["unrest", "unruhe (theatre)"], ["intensity", "intensität (theatre)"],
  ["quality", "steuer-qualität"],
];

/* Alle patchbaren Quellen — Flug + Drift + Sinne. Weitere Quellen (Sensoren …)
   hängen sich hier an. */
export const QUELLEN = [...FLIGHT_QUELLEN, ...LFO_QUELLEN, ...SENSE_QUELLEN];

/* Orts- & Richtungs-Quellen (räumliches Hören): keine 0..1-Werte, sondern
   POSITIONEN. Absichtlich NICHT in QUELLEN — Wert-Zeilen bieten sie nie an,
   und apply() überspringt ihre Records (die Quelle taucht nie im live-Mix
   auf). Die Positionen wendet SpatialAudio.frame() in App.frame() an.
   Record-Form: wie ein normales Mapping, plus control:"ort" und
   spatial:{ref, roll} (0..1 → refDistance 6..60 / rolloff 0.4..2.6). */
export const SPATIAL_QUELLEN = [
  ["duft_blume", "duft blume"], ["duft_lavendel", "duft lavendel"],
  ["duft_baum", "duft baum"], ["duft_kiefer", "duft kiefer"],
  ["duft_kraut", "duft kraut"], ["duft_pilz", "duft pilz"],
  // Neue Duftquellen (die authored Blumen + Tierfährte aus SCENT_TYPES).
  ["duft_rose", "duft rose"], ["duft_sonnenblume", "duft sonnenblume"],
  ["duft_mohn", "duft mohn"], ["duft_glocke", "duft glocke"],
  ["duft_klee", "duft klee"], ["duft_tier", "tierfährte"],
  ["kompass_n", "kompass n"], ["kompass_o", "kompass o"],
  ["kompass_s", "kompass s"], ["kompass_w", "kompass w"],
];
/* Ankerfarben — Welt (Punktwolken) und Flug-Karte (Buchsen) teilen sie.
   Deckungsgleich mit SCENT_TYPES.color in src/senses/duft/params.ts. */
export const SPATIAL_FARBEN = {
  duft_blume: "#ff4f9a", duft_lavendel: "#8a5cff", duft_baum: "#ffb340",
  duft_kiefer: "#2fd6a3", duft_kraut: "#b8e02e", duft_pilz: "#8a6f4d",
  duft_rose: "#ff2e5e", duft_sonnenblume: "#ffd21f", duft_mohn: "#ff5a2e",
  duft_glocke: "#3aa0ff", duft_klee: "#6ee06a", duft_tier: "#e86a3a",
  kompass_n: "#cad5df", kompass_o: "#cad5df", kompass_s: "#cad5df", kompass_w: "#cad5df",
};

/* ── Aggregat-Orte fürs Dropdown ─────────────────────────────────────────
   EIN Dropdown-Eintrag, der für VIELE Anker steht — SpatialAudio nimmt den
   nächsten davon. So braucht das Modul nicht pro Ort eine eigene Zeile. */
export const DUFT_IDS = SPATIAL_QUELLEN
  .map(([id]) => id).filter(id => id.startsWith("duft_"));
export const DUFT_GRUPPEN = {
  blumen: ["duft_blume", "duft_lavendel", "duft_rose", "duft_sonnenblume", "duft_mohn", "duft_glocke", "duft_klee"],
  baeume: ["duft_baum", "duft_kiefer"],
  kraut:  ["duft_kraut", "duft_pilz"],
  tiere:  ["duft_tier"],
};
/* Zusatz-Optionen, die VOR den Einzel-Orten im Dropdown stehen. */
export const ORT_AGGREGATE = [
  ["alle", "alle orte"],
  ["gruppe_blumen", "alle blumen"], ["gruppe_baeume", "alle bäume"],
  ["gruppe_kraut", "alle kräuter"], ["gruppe_tiere", "alle tiere"],
];
/* Volle Dropdown-Liste: Aggregate zuerst, dann alle Einzel-Orte. */
export const ORT_QUELLEN = [...ORT_AGGREGATE, ...SPATIAL_QUELLEN];
/* Aggregat/Einzel-Quelle → konkrete Anker-Ids (für SpatialAudio). */
export function expandOrtQuelle(q) {
  if (q === "alle") return DUFT_IDS;
  if (q.startsWith("gruppe_")) return DUFT_GRUPPEN[q.slice(7)] || [];
  return [q];
}
/* Ist die Quelle ein Ort / eine Richtung (inkl. Aggregate)? */
export function isOrtQuelle(q) {
  return q === "alle" || q.startsWith("gruppe_") ||
    q.startsWith("duft_") || q.startsWith("ort_") || q.startsWith("kompass_");
}
/* Zeigt diese Ort-Quelle Distanz-Regler? Alles außer Kompass (Richtungen
   dämpfen nie) — also Einzel-Düfte UND Aggregate. */
export function ortHasDistance(q) {
  return isOrtQuelle(q) && !q.startsWith("kompass_");
}

/* Ziele auf dem Master-Modul (Pseudo-layerId "master" — die Master-Kette
   existiert immer, unabhängig davon, ob die Karte gerade offen ist). */
export const MASTER_TARGETS = [
  ["eqlow", "tiefen"], ["eqmid", "mitten"], ["eqhigh", "höhen"], ["filter", "filter"],
  ["delaymix", "echo anteil"], ["delaytime", "echo zeit"], ["delayfb", "echo rückwurf"],
];
export const MASTER_COLOR = "#cad5df";

export class FlightMap {
  constructor(app) {
    this.app = app;
    this.list = [];
    this._subs = [];
  }

  /* Beobachter: Kabel-Overlay und Mapping-Sheet halten sich hierüber synchron.
     Feuert bei Struktur-Änderungen (anlegen/löschen/umstecken), nicht bei
     min/max/stärke/glätte-Drehungen. */
  on(fn) {
    this._subs.push(fn);
    return () => { this._subs = this._subs.filter(f => f !== fn); };
  }
  emit() { this._subs.forEach(f => { try { f(); } catch (e) {} }); }

  /* Mappings entfernen, deren Layer nicht mehr existiert.
     Master-Ziele bleiben immer — die Master-Kette lebt in der Engine. */
  prune() {
    const before = this.list.length;
    this.list = this.list.filter(m => m.layerId === "master" || this.layerById(m.layerId));
    if (this.list.length !== before) this.emit();
  }

  /* Alle belegbaren Ziele über alle aktiven Layer. */
  targets() {
    const out = [];
    this.app.layers.forEach((info, i) => {
      const L = info.layer, v = L.variant;
      const name = `${i + 1} ${L.sense.name}·${v.name}`;
      out.push({ id: L.id + "|padx", label: `${name} — pad ↔ (${v.xyLabels[0]})` });
      out.push({ id: L.id + "|pady", label: `${name} — pad ↕ (${v.xyLabels[1]})` });
      out.push({ id: L.id + "|pegel", label: `${name} — pegel` });
      out.push({ id: L.id + "|raum", label: `${name} — raum` });
      out.push({ id: L.id + "|cutoff", label: `${name} — cutoff` });
      if (L.handle.macro) out.push({ id: L.id + "|macro", label: `${name} — ${L.handle.macro.label}` });
      if (L.gen || L.chords || L.motif || L.turing) out.push({ id: L.id + "|melodie", label: `${name} — melodie` });
      (L.handle.params || []).forEach((p, idx) =>
        out.push({ id: L.id + "|param" + idx, label: `${name} — ${p.label}` }));
    });
    MASTER_TARGETS.forEach(([c, label]) =>
      out.push({ id: "master|" + c, label: `Master — ${label}` }));
    return out;
  }

  layerById(id) {
    const info = this.app.layers.find(x => x.layer.id === id);
    return info ? info.layer : null;
  }

  /* ---------- Orts-Bindungen (räumliches Hören) ---------- */
  isSpatial(q) { return isOrtQuelle(q); }

  /* Belegbare Ort-Ziele (jede Karte hat genau eine Ort-Buchse). */
  ortTargets() {
    return this.app.layers.map((info, i) => {
      const L = info.layer;
      return { id: L.id + "|ort", label: `${i + 1} ${L.sense.name}·${L.variant.name} — ort` };
    });
  }

  /* Aufgelöste Orts-Bindungen für SpatialAudio.frame(). */
  spatialBindings() {
    const out = [];
    for (const m of this.list) {
      if (m.control !== "ort") continue;
      const layer = this.layerById(m.layerId);
      if (layer) out.push({ m, layer });
    }
    return out;
  }

  /* Kabel-/Zeilen-Farbe eines Ziels (Master folgt dem Night/Day-Modus). */
  colorOf(layerId) {
    if (layerId === "master") {
      return document.body.classList.contains("day") ? "#54677a" : MASTER_COLOR;
    }
    const L = this.layerById(layerId);
    return L ? L.sense.color : "#7fd4e8";
  }

  /* ---------- Master lesen/schreiben (Engine.fx ist die Wahrheit) ---------- */
  readMaster(control) {
    const v = this.app.engine.fx[control];
    return v != null ? v : 0.5;
  }

  writeMaster(control, v) {
    const E = this.app.engine;
    switch (control) {
      case "eqlow": E.setEq("low", v); break;
      case "eqmid": E.setEq("mid", v); break;
      case "eqhigh": E.setEq("high", v); break;
      case "filter": E.setFilterCutoff(v); break;
      case "delaymix": E.setDelayMix(v); break;
      case "delaytime": E.setDelayTime(v); break;
      case "delayfb": E.setDelayFeedback(v); break;
    }
  }

  readControl(L, control) {
    switch (control) {
      case "padx": return L.xy ? L.xy[0] : 0.5;
      case "pady": return L.xy ? L.xy[1] : 0.5;
      case "pegel": return L.volume;
      case "raum": return L.roomVal;
      case "cutoff": return L.cutVal;
      case "macro": return L.macroVal;
      case "melodie": return L.melodyVal;
    }
    // Klang-Inneres: param0..n → Tiefen-Regler der aktuellen Variante
    if (control.startsWith("param")) {
      const i = +control.slice(5);
      if (L.paramVals && L.paramVals[i] != null) return L.paramVals[i];
    }
    return 0.5;
  }

  writeControl(info, control, v) {
    const L = info.layer;
    switch (control) {
      case "padx": L.setXY(v, L.xy[1]); if (info.pad) info.pad.value = [v, L.xy[1]]; break;
      case "pady": L.setXY(L.xy[0], v); if (info.pad) info.pad.value = [L.xy[0], v]; break;
      case "pegel": L.setVolume(v); break;
      case "raum": L.setRoom(v); break;
      case "cutoff": L.setCut(v); break;
      case "macro": L.setMacro(v); break;
      case "melodie": L.setMelody(v); break;
      default:
        // Klang-Inneres (setParam prüft selbst, ob der Index existiert —
        // nach Varianten-Wechsel kann er ins Leere zeigen)
        if (control.startsWith("param")) L.setParam(+control.slice(5), v);
    }
  }

  /* Einheitliches Lesen/Schreiben — Layer-Regler oder Master-Kette. */
  readTarget(layerId, control) {
    if (layerId === "master") return this.readMaster(control);
    const L = this.layerById(layerId);
    return L ? this.readControl(L, control) : null;
  }

  writeTarget(layerId, control, v) {
    if (layerId === "master") { this.writeMaster(control, v); return true; }
    const info = this.app.layers.find(x => x.layer.id === layerId);
    if (!info) return false;
    this.writeControl(info, control, v);
    return true;
  }

  add(targetId, quelle = "hoehe") {
    const t = targetId || (this.targets()[0] && this.targets()[0].id);
    if (!t) return null;
    const [layerId, control] = t.split("|");
    // Orts-Buchsen nehmen nur Orts-/Richtungs-Quellen an — und umgekehrt.
    if (this.isSpatial(quelle) !== (control === "ort")) return null;
    if (control === "ort") {
      // Mehrere Orte pro Sinn erlaubt — nur dieselbe Quelle nicht doppelt.
      const ex = this.list.find(
        x => x.layerId === layerId && x.control === "ort" && x.quelle === quelle);
      if (ex) return ex;
    }
    const base = this.readTarget(layerId, control);
    if (base == null) return null;
    const m = {
      quelle, layerId, control,
      min: 0, max: 1, staerke: 1, glatt: 0.4, kurve: "linear",
      base, cur: null,
    };
    if (control === "ort") m.spatial = { ref: 0.15, roll: 0.45 };
    this.list.push(m);
    this.emit();
    return m;
  }

  retarget(m, targetId) {
    this.restore(m);
    const [layerId, control] = targetId.split("|");
    m.layerId = layerId; m.control = control;
    const base = this.readTarget(layerId, control);
    m.base = base != null ? base : 0.5;
    m.cur = null;
    this.emit();
  }

  restore(m) {
    this.writeTarget(m.layerId, m.control, m.base);
  }

  remove(m) {
    this.restore(m);
    this.list = this.list.filter(x => x !== m);
    this.emit();
  }

  curve(v, kind) {
    switch (kind) {
      case "sanft": return v * v * (3 - 2 * v);            // smoothstep
      case "exp":   return v * v * v;                       // spät stark
      case "log":   return 1 - (1 - v) * (1 - v) * (1 - v); // früh stark
      case "mitte": return 0.5 + Math.sin((v - 0.5) * Math.PI) * 0.5; // Mitte gedehnt
      default:      return v;                               // linear
    }
  }

  /* Jede Frame: die LIVE-Quellen auf die Ziele anwenden. Quellen, die
     gerade nicht laufen (Flug zu, Drift aus), fehlen im params-Objekt —
     ihre Zuordnungen frieren ein, statt auf einen Standardwert zu springen. */
  apply(params) {
    for (const m of this.list) {
      const raw = params[m.quelle];
      if (raw == null) continue;
      const val = m.min + (m.max - m.min) * this.curve(raw, m.kurve);
      if (m.cur == null) m.cur = val;
      m.cur += (val - m.cur) * (1 - Math.min(0.97, m.glatt * 0.97)); // Trägheit
      const out = m.base + (m.cur - m.base) * m.staerke;
      this.writeTarget(m.layerId, m.control, Math.max(0, Math.min(1, out)));
    }
  }

  disposeAll(restore) {
    if (restore) this.list.forEach(m => this.restore(m));
    this.list = [];
    this.emit();
  }
};
