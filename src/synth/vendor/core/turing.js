/* becoming many · core/turing.js
   Die SCHLEIFEN-Stimme (nach dem "Turing machine"-Prinzip der Modularwelt):
   Eine kurze Zufallssequenz aus der Welt-Skala läuft im Kreis — sie ist
   GELOCKT, man erkennt sie wieder. Der WANDEL-Regler bestimmt, wie viele
   Schritte sich bei jeder Runde heimlich verändern: 0 = die Schleife
   bleibt für immer, 1 = sie zerfließt ständig zu etwas Neuem.
   DICHTE wählt eine feste Teilmenge der Schläge (deterministisch pro
   Schritt, kein Würfeln pro Tick) — leiser heißt lichter, nicht zufälliger. */

import * as Tone from "tone";

export class TuringVoice {
  /**
   * @param engine  Engine (Welt-Skala & Grundton)
   * @param m       Rezept (mutierbar):
   *   synth     – Instrument mit triggerAttackRelease
   *   interval  – Schrittraster ("8n" …)
   *   dur       – Notenlänge
   *   baseOct   – Lage über dem Grundton
   *   octaves   – Spielraum in Oktaven
   *   vel       – Anschlagstärke
   *   len       – Schleifenlänge in Schritten (2..16, Standard 8)
   *   mutate    – Wandel 0..1: Anteil der Schritte, die pro Runde mutieren
   */
  constructor(engine, m) {
    this.engine = engine;
    this.m = m;
    this.density = 0;
    this.len = Math.max(2, Math.min(16, m.len || 8));
    this.mutate = m.mutate != null ? m.mutate : 0.15;
    this.seq = Array.from({ length: 16 }, () => this.newStep());
    this.pos = 0;
    this.loop = new Tone.Loop((t) => this.tick(t), m.interval || "8n").start(0);
  }

  span() { return this.engine.world.scale.length * (this.m.octaves || 2); }

  newStep() {
    return {
      deg: Math.floor(Math.random() * this.span()),
      gate: Math.random() < 0.75,
      chance: Math.random(),        // feste Schwelle: dichte wählt Teilmenge
    };
  }

  /* Die ganze Schleife neu würfeln (bewusst, per Knopf). */
  reroll() { this.seq = this.seq.map(() => this.newStep()); }

  tick(time) {
    if (this.density <= 0.02) return;
    const i = this.pos % this.len;
    this.pos++;

    // Rundenwechsel: der Wandel nagt an einzelnen Schritten
    if (i === 0 && this._kicked && this.mutate > 0) {
      for (const st of this.seq) {
        if (Math.random() < this.mutate * 0.3) {
          if (Math.random() < 0.65) {
            st.deg = Math.max(0, Math.min(this.span() - 1,
              st.deg + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]));
          } else {
            st.gate = !st.gate;
          }
        }
      }
    }

    const st = this.seq[i];
    if (!this._kicked) { st.gate = true; st.chance = 0; }   // erste Note garantiert
    this._kicked = true;
    if (!st.gate || st.chance > this.density) return;

    const w = this.engine.world, sc = w.scale;
    const deg = Math.min(st.deg, this.span() - 1);
    const midi = w.rootMidi + (this.m.baseOct || 2) * 12
               + Math.floor(deg / sc.length) * 12 + sc[deg % sc.length];
    try {
      this.m.synth.triggerAttackRelease(
        Tone.Frequency(midi, "midi").toFrequency(),
        this.m.dur || "8n", time,
        this.m.vel != null ? this.m.vel : 0.6);
    } catch (e) { /* Stimmenlimit → still überspringen */ }
  }

  setDensity(v)  { this.density = v; }
  setInterval(v) { this.loop.interval = v; }
  setLen(n)      { this.len = Math.max(2, Math.min(16, Math.round(n))); }
  setMutate(v)   { this.mutate = v; }
  dispose()      { this.loop.dispose(); }
}
