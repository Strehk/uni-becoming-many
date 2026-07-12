/* becoming many · core/chords.js
   Akkorde als Melodiequelle: Man wählt Akkorde aus einer Palette, die
   Folge kreist im eigenen Tempo, und eine Stimme spielt die Akkordtöne
   nach einem Muster (auf/ab/pendel/zufall/block) — Melodie mit Harmonie-
   Gerüst, weiterhin ohne eine einzige Note spielen zu müssen.
   Alle Akkorde beziehen sich auf den Welt-Grundton. */

import * as Tone from "tone";

/* Palette relativ zum Grundton (Moll-zentriert, passt zur Welt-Stimmung). */
export const CHORD_PALETTE = [
  { id: "i",    label: "i",       off: 0,  type: [0, 3, 7] },
  { id: "III",  label: "III",     off: 3,  type: [0, 4, 7] },
  { id: "iv",   label: "iv",      off: 5,  type: [0, 3, 7] },
  { id: "v",    label: "v",       off: 7,  type: [0, 3, 7] },
  { id: "VI",   label: "VI",      off: 8,  type: [0, 4, 7] },
  { id: "VII",  label: "VII",     off: 10, type: [0, 4, 7] },
  { id: "sus",  label: "i sus4",  off: 0,  type: [0, 5, 7] },
  { id: "m7",   label: "i m7",    off: 0,  type: [0, 3, 7, 10] },
  { id: "q",    label: "quarten", off: 0,  type: [0, 5, 10] },
];

export class ChordVoice {
  /**
   * @param engine Engine
   * @param m      Rezept (mutierbar):
   *   synth         – Instrument mit triggerAttackRelease
   *   interval      – Schrittraster der Muster-Stimme ("8n" …)
   *   dur, baseOct, octaves, vel – wie bei der Wanderstimme
   *   pattern       – "auf" | "ab" | "pendel" | "zufall" | "block"
   *   wechsel       – Sekunden pro Akkord
   *   defaultChords – Start-Auswahl (ids aus der Palette)
   *   onChord(tonesMidi, time) – optional: eigener Klang beim Akkordwechsel
   *                              (Block-Schwell, gleitende Stimmen, …)
   */
  constructor(engine, m) {
    this.engine = engine;
    this.m = m;
    this.density = 0;
    this.pattern = m.pattern || "auf";
    this.sel = new Set(m.defaultChords || ["i", "VI", "III", "VII"]);
    this.pos = -1;
    this.step = 0;
    this.chord = null;

    this.wechselLoop = new Tone.Loop((t) => this.advance(t), m.wechsel || 6).start(0);
    this.noteLoop = new Tone.Loop((t) => this.tick(t), m.interval || "8n").start(0);
    // Erster Akkord sofort, nicht erst nach einer vollen Wechsel-Periode.
    try { Tone.Transport.scheduleOnce((t) => this.advance(t), "+0.15"); } catch (e) {}
  }

  selected() { return CHORD_PALETTE.filter(c => this.sel.has(c.id)); }

  advance(time) {
    const list = this.selected();
    if (!list.length) { this.chord = null; return; }
    this.pos = (this.pos + 1) % list.length;
    this.chord = list[this.pos];
    this.step = 0;
    if (this.m.onChord) {
      try { this.m.onChord(this.tones(), time); } catch (e) {}
    }
  }

  /* Akkordtöne als MIDI-Nummern, über `octaves` Lagen ausgebreitet. */
  tones() {
    const c = this.chord;
    if (!c) return [];
    const base = this.engine.world.rootMidi + (this.m.baseOct || 2) * 12 + c.off;
    const out = [];
    for (let o = 0; o < (this.m.octaves || 1); o++) {
      c.type.forEach(s => out.push(base + s + o * 12));
    }
    return out;
  }

  tick(time) {
    if (!this.chord || this.density <= 0.02) return;
    // Erste Note garantiert sofort — danach entscheidet der Dichte-Würfel.
    if (this._kicked && Math.random() > this.density) return;
    this._kicked = true;
    const tones = this.tones();
    if (!tones.length) return;
    const dur = this.m.dur || "8n";
    const vel = this.m.vel != null ? this.m.vel : 0.5;

    if (this.pattern === "block") {
      tones.forEach((mm, i) => {
        try { this.m.synth.triggerAttackRelease(
          Tone.Frequency(mm, "midi").toFrequency(), dur, time + i * 0.02, vel * 0.8); } catch (e) {}
      });
      return;
    }
    let idx;
    if (this.pattern === "ab") {
      idx = tones.length - 1 - (this.step % tones.length); this.step++;
    } else if (this.pattern === "pendel") {
      const n = Math.max(1, tones.length - 1);
      const p = this.step % (2 * n);
      idx = p < n ? p : 2 * n - p; this.step++;
    } else if (this.pattern === "zufall") {
      idx = Math.floor(Math.random() * tones.length);
    } else { // "auf"
      idx = this.step % tones.length; this.step++;
    }
    try { this.m.synth.triggerAttackRelease(
      Tone.Frequency(tones[idx], "midi").toFrequency(), dur, time, vel); } catch (e) {}
  }

  toggle(id) {
    if (this.sel.has(id)) { if (this.sel.size > 1) this.sel.delete(id); }
    else this.sel.add(id);
  }
  setDensity(v) { this.density = v; }
  setPattern(p) { this.pattern = p; this.step = 0; }
  setWechsel(sec) { this.wechselLoop.interval = sec; }
  dispose() { this.wechselLoop.dispose(); this.noteLoop.dispose(); }
};
