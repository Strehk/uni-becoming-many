/* becoming many · core/motif.js
   Die Motiv-Stimme komponiert generativ: Sie erfindet eine kurze Phrase
   aus der Welt-Skala, spielt sie, wiederholt sie ein paar Mal, VARIIERT
   sie dabei (transponieren, einzelne Töne mutieren), atmet zwischen den
   Phrasen — und erfindet dann eine neue. Das klingt nach Melodie mit
   Absicht, ganz ohne dass jemand Noten spielt. */

import * as Tone from "tone";

export class MotifVoice {
  /**
   * @param engine Engine
   * @param m      Rezept (mutierbar):
   *   synth      – Instrument mit triggerAttackRelease
   *   interval   – Schrittraster ("8n" …)
   *   baseOct    – Lage über dem Grundton
   *   octaves    – Spielraum der Phrasen in Oktaven
   *   vel        – Anschlagstärke
   *   phraseLen  – Töne pro Phrase (Standard 4–6, zufällig)
   *   variation  – 0..1: wie stark sich Wiederholungen verändern
   *   maxRepeats – nach so vielen Durchläufen kommt eine neue Phrase
   *   restBase   – Atempause zwischen Phrasen (in Rasterschritten)
   *   dur        – feste Notenlänge; ohne Angabe folgt sie dem Raster
   */
  constructor(engine, m) {
    this.engine = engine;
    this.m = m;
    this.density = 0;
    this.variation = m.variation != null ? m.variation : 0.35;
    this.restBase = m.restBase != null ? m.restBase : 3;
    this.phrase = []; this.idx = 0; this.hold = 0; this.rest = 0; this.repeats = 0;
    this.loop = new Tone.Loop((t) => this.tick(t), m.interval || "8n").start(0);
  }

  span() { return this.engine.world.scale.length * (this.m.octaves || 2); }

  /* Eine neue Phrase erfinden: Kontur aus kleinen Schritten, Ende gedehnt. */
  newPhrase() {
    const len = this.m.phraseLen || (4 + Math.floor(Math.random() * 3));
    let d = Math.floor(Math.random() * this.span());
    const ph = [];
    for (let i = 0; i < len; i++) {
      ph.push({ deg: d, len: Math.random() < 0.25 ? 2 : 1 });
      let st = [-2, -1, -1, 1, 1, 2, 3][Math.floor(Math.random() * 7)];
      if (Math.random() < 0.3) st = -st;
      d = Math.max(0, Math.min(this.span() - 1, d + st));
    }
    ph[len - 1].len = 2;                      // Phrasenschluss atmet aus
    this.phrase = ph; this.idx = 0; this.repeats = 0;
  }

  /* Die Phrase bei der Wiederholung leicht verwandeln. */
  vary() {
    if (!this.phrase.length) return;
    const clamp = (x) => Math.max(0, Math.min(this.span() - 1, x));
    if (Math.random() < 0.5) {                // ganze Phrase verschieben
      const t = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
      this.phrase.forEach(n => { n.deg = clamp(n.deg + t); });
    } else {                                  // 1–2 Töne mutieren
      const k = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < k; i++) {
        const n = this.phrase[Math.floor(Math.random() * this.phrase.length)];
        n.deg = clamp(n.deg + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]);
      }
    }
  }

  tick(time) {
    if (this.density <= 0.02) return;
    if (this.hold > 0) { this.hold--; return; }
    if (this.rest > 0) { this.rest--; return; }

    if (this.idx >= this.phrase.length) {
      if (this.phrase.length) {
        this.repeats++;
        this.rest = Math.max(0, Math.round(this.restBase * (1.4 - this.density)));
        if (this.repeats >= (this.m.maxRepeats || 3)) this.newPhrase();
        else if (Math.random() < this.variation) this.vary();
        this.idx = 0;
        if (this.rest > 0) return;
      } else {
        // Allererste Phrase: sofort erfinden UND sofort losspielen,
        // statt erst beim nächsten Rasterschritt zu beginnen.
        this.newPhrase();
      }
    }

    const w = this.engine.world, sc = w.scale;
    const n = this.phrase[this.idx++];
    const midi = w.rootMidi + (this.m.baseOct || 3) * 12
               + Math.floor(n.deg / sc.length) * 12 + sc[n.deg % sc.length];
    let beat = 0.25;
    try { beat = Tone.Time(this.loop.interval).toSeconds(); } catch (e) {}
    const dur = this.m.dur != null ? this.m.dur : Math.max(0.08, beat * n.len * 0.9);
    this.hold = n.len - 1;
    try {
      this.m.synth.triggerAttackRelease(
        Tone.Frequency(midi, "midi").toFrequency(), dur, time,
        this.m.vel != null ? this.m.vel : 0.5);
    } catch (e) { /* Stimmenlimit → still überspringen */ }
  }

  setDensity(v)  { this.density = v; }
  setInterval(v) { this.loop.interval = v; }
  dispose()      { this.loop.dispose(); }
};
