/* becoming many · core/engine.js
   Die Engine ist das gemeinsame Ohr: Master-Kette (Limiter gegen Übersteuern),
   ein globaler Hall als "Raum", in den alle Sinne senden, und der Welt-Zustand
   (Grundton, Skala, Puls), auf den sich alle generativen Stimmen beziehen —
   so harmonieren die Layer automatisch miteinander. */

import * as Tone from "tone";

export const SCALES = {
  "pent. moll":  [0, 3, 5, 7, 10],
  "pent. dur":   [0, 2, 4, 7, 9],
  "dorisch":     [0, 2, 3, 5, 7, 9, 10],
  "ganzton":     [0, 2, 4, 6, 8, 10],
  "hirajoshi":   [0, 2, 3, 7, 8],
};

export class Engine {
  constructor() {
    this.running = false;

    // Welt-Zustand: alle Layer lesen hieraus → gemeinsame Harmonie.
    this.world = {
      rootMidi: Tone.Frequency("A2").toMidi(),
      scaleName: "pent. moll",
      scale: SCALES["pent. moll"],
    };

    // Master: Layer → master → EQ → Filter → [Delay] → Limiter → Lautsprecher
    // EQ und Filter starten neutral und kosten fast nichts (Biquads);
    // das Delay wird erst beim ersten Aufdrehen erzeugt (lazy).
    this.master = new Tone.Gain(0.8);
    this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
    this.filter = new Tone.Filter(20000, "lowpass");
    this.limiter = new Tone.Limiter(-1);
    this.master.connect(this.eq);
    this.eq.connect(this.filter);
    this.filter.connect(this.limiter);
    this.limiter.toDestination();
    this.delay = null;

    // Aktuelle FX-Stellungen (alle 0..1) — Quelle der Wahrheit für
    // Master-Karte UND Patch-Kabel aufs Master-Modul.
    this.fx = { eqlow: 0.5, eqmid: 0.5, eqhigh: 0.5, filter: 1,
                delaymix: 0, delaytime: 0.32, delayfb: 0.4 };

    // Globaler Hall: Tone.Reverb (Faltung, keine AudioWorklets → läuft
    // auch aus lokal geöffneten Dateien). Layer senden per "Raum" hinein.
    this.reverb = new Tone.Reverb({ decay: 9, preDelay: 0.04, wet: 1 });
    this.reverb.connect(this.master);

    // Wellenform-Analyse für das Atem-Band im Kopf der App.
    this.wave = new Tone.Analyser("waveform", 256);
    this.master.connect(this.wave);
  }

  /* Muss aus einer Berührung heraus aufgerufen werden (Web-Audio-Regel).
     iOS/Safari: Kontext explizit resumen und leeren Buffer abspielen,
     sonst bleibt der AudioContext trotz Tone.start() "suspended". */
  async start() {
    if (this.running) return;
    await Tone.start();
    const ctx = Tone.getContext().rawContext;
    if (ctx.state !== "running") { try { await ctx.resume(); } catch (e) {} }
    // iOS-Unlock: kurzer stummer Ton entriegelt die Audio-Ausgabe.
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) {}
    Tone.Transport.bpm.value = 54;   // ruhiger Grundpuls
    Tone.Transport.start();
    this.running = true;
  }

  /* true, wenn der AudioContext wirklich läuft (nicht nur "gestartet"). */
  isAudible() {
    try { return Tone.getContext().rawContext.state === "running"; }
    catch (e) { return false; }
  }

  setRoot(note)  { this.world.rootMidi = Tone.Frequency(note).toMidi(); }
  setScale(name) {
    if (SCALES[name]) { this.world.scaleName = name; this.world.scale = SCALES[name]; }
  }
  setPulse(bpm)  { Tone.Transport.bpm.rampTo(bpm, 2); }
  setMasterVolume(v) { this.master.gain.rampTo(v, 0.05); } // 0..1

  /* ---------- Master-Effekte (alle Werte 0..1, 0.5/1.0 = neutral) ---------- */

  setEq(band, v) {                       // band: "low" | "mid" | "high"
    this.fx["eq" + band] = v;
    const db = (v - 0.5) * 30;           // ±15 dB, 0.5 = neutral
    if (this.eq[band]) this.eq[band].rampTo(db, 0.08);
  }

  setFilterCutoff(v) {                   // exponentiell 80 Hz … 20 kHz, 1 = offen
    this.fx.filter = v;
    const f = 80 * Math.pow(20000 / 80, v);
    this.filter.frequency.rampTo(f, 0.08);
  }

  /* Delay entsteht beim ersten Zugriff und hängt sich zwischen Filter
     und Limiter — vorher existiert es gar nicht (Performance). */
  ensureDelay() {
    if (this.delay) return;
    this.delay = new Tone.FeedbackDelay({ delayTime: 0.35, feedback: 0.35, wet: 0 });
    this.filter.disconnect(this.limiter);
    this.filter.connect(this.delay);
    this.delay.connect(this.limiter);
  }
  setDelayMix(v)      { this.fx.delaymix = v; this.ensureDelay(); this.delay.wet.rampTo(v * 0.6, 0.08); }
  setDelayTime(v)     { this.fx.delaytime = v; this.ensureDelay(); this.delay.delayTime.rampTo(0.06 + v * 0.9, 0.15); }
  setDelayFeedback(v) { this.fx.delayfb = v; this.ensureDelay(); this.delay.feedback.rampTo(v * 0.85, 0.08); }

  /* Hall-Charakter: Impulsantwort wird neu erzeugt (kurz & unhörbar). */
  async setReverbCharacter(name) {
    const p = REVERB_PRESETS[name];
    if (!p) return;
    this.reverb.decay = p.decay;
    this.reverb.preDelay = p.preDelay;
    try { await this.reverb.generate(); } catch (e) {}
  }
};

export const REVERB_PRESETS = {
  "kammer": { decay: 3,  preDelay: 0.02 },
  "halle":  { decay: 9,  preDelay: 0.04 },
  "dom":    { decay: 16, preDelay: 0.07 },
};
