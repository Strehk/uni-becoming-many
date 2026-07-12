/* becoming many · core/generative.js
   Melodie ohne Noten: eine Wander-Stimme läuft als "Random Walk" über die
   gemeinsame Welt-Skala. Man spielt nichts — man regelt DICHTE, RICHTUNG,
   RASTER, LAGE, SPIELRAUM. Weil alle Stimmen dieselbe Skala + denselben
   Grundton benutzen, layern sie harmonisch übereinander. */

import * as Tone from "tone";

export class Generative {
  /**
   * @param engine  Engine (liefert Welt-Skala & Grundton)
   * @param m       melodisches Rezept (mutierbar — Regler schreiben live rein):
   *   synth        – Instrument mit triggerAttackRelease(freq, dur, time, vel)
   *   interval     – Schrittraster, z.B. "8n" (Standard "4n")
   *   dur          – Notenlänge ("2n" oder Sekunden)
   *   baseOct      – Lage über dem Grundton in Oktaven
   *   octaves      – Wander-Spielraum in Oktaven (Standard 2)
   *   vel          – Anschlagstärke 0..1
   *   bias         – Richtung des Wanderns: -1 fallend .. 0 frei .. +1 steigend
   *   wrap         – true: am Rand auf die andere Seite springen (Thermik!)
   *   cluster      – true: zusätzlich leicht verstimmte Nachbarstimmen
   *   clusterCents – Verstimmung der Nachbarn in Cents
   */
  constructor(engine, m) {
    this.engine = engine;
    this.m = m;
    this.density = 0;
    this.degree = Math.floor(Math.random() * 5);
    this.loop = new Tone.Loop((t) => this.tick(t), m.interval || "4n").start(0);
  }

  tick(time) {
    if (this.density <= 0.02) return;
    // Erste Note garantiert sofort — danach entscheidet der Dichte-Würfel.
    // (Sonst kann eine Stimme mit niedriger Dichte viele Sekunden schweigen.)
    if (this._kicked && Math.random() > this.density) return;
    this._kicked = true;

    const w = this.engine.world;
    const scale = w.scale;
    const span = scale.length * (this.m.octaves || 2);

    // Wander-Schritt: kleine Schritte wahrscheinlicher als Sprünge …
    let step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    // … Richtungs-Bias zieht den Schritt in eine Richtung.
    const bias = this.m.bias || 0;
    if (bias !== 0 && Math.random() < Math.abs(bias)) {
      step = Math.sign(bias) * Math.max(1, Math.abs(step));
    }
    this.degree += step;
    if (this.m.wrap) {
      if (this.degree >= span) this.degree = 0;          // Umbruch: neue Thermik
      else if (this.degree < 0) this.degree = span - 1;
    } else {
      this.degree = Math.max(0, Math.min(span - 1, this.degree));
    }

    const oct = Math.floor(this.degree / scale.length);
    const semis = scale[this.degree % scale.length];
    const midi = w.rootMidi + (this.m.baseOct || 0) * 12 + oct * 12 + semis;
    const freq = Tone.Frequency(midi, "midi").toFrequency();
    const dur = this.m.dur || "2n";
    const vel = this.m.vel != null ? this.m.vel : 0.5;

    try {
      this.m.synth.triggerAttackRelease(freq, dur, time, vel);
      if (this.m.cluster) {
        const c = this.m.clusterCents || 18;
        this.m.synth.triggerAttackRelease(freq * Math.pow(2,  c / 1200), dur, time + 0.03, vel * 0.6);
        this.m.synth.triggerAttackRelease(freq * Math.pow(2, -c / 1200), dur, time + 0.06, vel * 0.5);
      }
    } catch (e) { /* Stimmenlimit → still überspringen */ }
  }

  setDensity(v)  { this.density = v; }
  setInterval(v) { this.loop.interval = v; }   // z.B. "16n".."1n"
  dispose()      { this.loop.dispose(); }
};
