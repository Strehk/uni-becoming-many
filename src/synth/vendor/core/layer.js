/* becoming many · core/layer.js
   Ein SenseLayer ist der generische Rahmen um eine HERANGEHENSWEISE
   (Variante) eines Sinns:
     Varianten-Klangquelle → bus → out (Volume/Mute) → Master
                                     └→ send ("Raum") → globaler Hall
   Der Hall-Send hängt HINTER Pegel/Mute (post-fader) — Pegel auf null
   oder Stummschalten macht den Sinn wirklich still, auch im Raum.
   Die Herangehensweise kann live gewechselt werden (weiche Überblendung):
   Rahmen bleibt, nur das Innenleben wird ausgetauscht. */

import * as Tone from "tone";
import { Generative } from "./generative.js";
import { ChordVoice } from "./chords.js";
import { MotifVoice } from "./motif.js";
import { TuringVoice } from "./turing.js";

let LAYER_SEQ = 0;

export class SenseLayer {
  /**
   * @param sense    Eintrag aus SENSES
   * @param engine   Engine
   * @param variantIdx  Index der Herangehensweise (Standard 0)
   */
  constructor(sense, engine, variantIdx = 0) {
    this.id = "L" + (++LAYER_SEQ);
    this.sense = sense;
    this.recipe = sense;                 // Alias (Farbe/Name fürs UI)
    this.engine = engine;
    this.muted = false;

    // Signalrahmen (bleibt über Varianten-Wechsel hinweg bestehen)
    this.bus = new Tone.Gain(1);
    this.cut = new Tone.Filter(20000, "lowpass");   // eigener Cutoff pro Sinn
    this.out = new Tone.Gain(0);
    this.send = new Tone.Gain(0.3 * 1.5);   // = roomVal-Startwert × Send-Faktor
    this.bus.connect(this.cut);
    this.cut.connect(this.out);
    this.out.connect(this.send);      // post-fader: Pegel/Mute wirken auch auf den Hall
    this.out.connect(engine.master);
    this.send.connect(engine.reverb);

    this.meter = new Tone.Meter({ smoothing: 0.85, normalRange: true });
    this.out.connect(this.meter);

    // Eigene Wellenform des Sinns — das Atem-Band oben zeigt pro Layer
    // sein tatsächliches Signal, nicht die Master-Summe. 2048 Samples
    // (~46 ms): erst darin werden tiefe Drones als Wellenzug sichtbar.
    this.wave = new Tone.Analyser("waveform", 2048);
    this.out.connect(this.wave);

    // Wird vom Spatial-System (core/spatial.js) lazily zwischen cut und
    // out gehängt, sobald der Sinn räumlich gebunden wird.
    this.panner = null;

    // Regler-Zustand (überlebt Varianten-Wechsel, wo sinnvoll)
    this.volume = 0.75;
    this.roomVal = 0.3;
    this.cutVal = 1;                  // Cutoff offen

    // Welche Regler die kompakte Karte zeigt — Auswahl per Checkbox im
    // erweiterten Modus (UI-Zustand, von app.js gepflegt). null =
    // Standard: alles außer Klang-Inneres.
    this.shown = null;

    this.buildVariant(variantIdx, true);
    this.out.gain.rampTo(this.volume * 0.6, 1.2);   // sanftes Erwachen
  }

  get variant() { return this.sense.variants[this.variantIdx]; }

  /* Innenleben (neu) aufbauen. first=true beim allerersten Aufbau. */
  buildVariant(idx, first) {
    const doBuild = () => {
      // Altes Innenleben restlos entsorgen
      if (this.gen) { this.gen.dispose(); this.gen = null; }
      if (this.chords) { this.chords.dispose(); this.chords = null; }
      if (this.motif) { this.motif.dispose(); this.motif = null; }
      if (this.turing) { this.turing.dispose(); this.turing = null; }
      if (this.handle && this.handle.dispose) this.handle.dispose();

      this.variantIdx = idx;
      const v = this.variant;
      this.handle = v.build(this.bus, this.engine);

      // Tiefen-Parameter auf Startwerte
      this.paramVals = (this.handle.params || []).map(p => p.default);
      (this.handle.params || []).forEach(p => p.set(p.default));
      this.macroVal = this.handle.macro ? this.handle.macro.default : 0;
      if (this.handle.macro) this.handle.macro.set(this.macroVal);

      // Wanderstimme (freier Skalen-Walk) ODER Akkordstimme (gewählte Folge)
      if (this.handle.melodic) {
        this.gen = new Generative(this.engine, this.handle.melodic);
        this.melodyVal = v.melodyDefault != null ? v.melodyDefault : 0;
        this.gen.setDensity(this.melodyVal);
      } else if (this.handle.chordal) {
        this.chords = new ChordVoice(this.engine, this.handle.chordal);
        this.melodyVal = v.melodyDefault != null ? v.melodyDefault : 0.4;
        this.chords.setDensity(this.melodyVal);
      } else if (this.handle.motif) {
        this.motif = new MotifVoice(this.engine, this.handle.motif);
        this.melodyVal = v.melodyDefault != null ? v.melodyDefault : 0.6;
        this.motif.setDensity(this.melodyVal);
      } else if (this.handle.turing) {
        this.turing = new TuringVoice(this.engine, this.handle.turing);
        this.melodyVal = v.melodyDefault != null ? v.melodyDefault : 0.7;
        this.turing.setDensity(this.melodyVal);
      } else {
        this.melodyVal = 0;
      }

      this.setXY(v.xyDefault ? v.xyDefault[0] : 0.5,
                 v.xyDefault ? v.xyDefault[1] : 0.5);

      if (!first && !this.muted) this.bus.gain.rampTo(1, 0.4);
    };

    if (first) { doBuild(); return; }
    // Weicher Wechsel: kurz ausblenden, tauschen, wieder einblenden.
    this.bus.gain.rampTo(0, 0.25);
    setTimeout(doBuild, 300);
  }

  setXY(x, y) { this.xy = [x, y]; this.handle.setXY(x, y); }

  setVolume(v) { this.volume = v; if (!this.muted) this.out.gain.rampTo(v * 0.6, 0.08); }
  // Faktor 1.5 gleicht aus, dass der Send jetzt post-fader liegt
  // (das Signal kommt bereits mit volume*0.6 an) — raum klingt wie gewohnt.
  setRoom(v)   { this.roomVal = v; this.send.gain.rampTo(v * 1.5, 0.08); }
  // Cutoff exponentiell 80 Hz … 20 kHz, 1 = offen (wie beim Master-Filter)
  setCut(v)    { this.cutVal = v; this.cut.frequency.rampTo(80 * Math.pow(250, v), 0.08); }
  setMacro(v)  { this.macroVal = v; if (this.handle.macro) this.handle.macro.set(v); }
  setMelody(v) {
    this.melodyVal = v;
    if (this.gen) this.gen.setDensity(v);
    if (this.chords) this.chords.setDensity(v);
    if (this.motif) this.motif.setDensity(v);
    if (this.turing) this.turing.setDensity(v);
  }
  setParam(i, v) {
    this.paramVals[i] = v;
    if (this.handle.params && this.handle.params[i]) this.handle.params[i].set(v);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.out.gain.rampTo(this.muted ? 0 : this.volume * 0.6, 0.25);
    return this.muted;
  }

  level() { const v = this.meter.getValue(); return Number.isFinite(v) ? v : 0; }

  dispose() {
    this.out.gain.rampTo(0, 0.3);
    setTimeout(() => {
      if (this.gen) this.gen.dispose();
      if (this.chords) this.chords.dispose();
      if (this.motif) this.motif.dispose();
      if (this.turing) this.turing.dispose();
      if (this.handle.dispose) this.handle.dispose();
      [this.bus, this.cut, this.out, this.send, this.meter, this.wave, this.panner]
        .filter(Boolean).forEach(n => n.dispose());
    }, 400);
  }
};
