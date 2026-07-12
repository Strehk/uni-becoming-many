/* becoming many · senses/registry.js
   ══════════════════════════════════════════════════════════════════
   DAS SINNES-REGISTER. Jede Wahrnehmung hat mehrere HERANGEHENSWEISEN
   (variants) — nicht Presets, sondern grundverschiedene musikalische
   Ansätze mit eigener Klangerzeugung.

   Varianten-Form:
     id, name, desc               – Identität
     xyLabels, xyDefault          – Achsen + Startposition des Pads
     melodyDefault                – Startdichte der Wanderstimme (null = keine)
     build(bus, engine) → {
       setXY(x, y)                – Pad → Klang
       macro: {label, set, default}          – der Haupt-Extra-Regler
       params: [{label, set, default}, …]    – Tiefen-Regler (erweiterter Modus)
       melodic?                   – Rezept für Generative
       dispose()                  – restlos aufräumen
     }
   ══════════════════════════════════════════════════════════════════ */

import * as Tone from "tone";

export const SENSES = [

/* ══ LUFT ═══════════════════════════════════════════════════════ */
{
  id: "luft", name: "Luft", color: "#7fd4e8",
  desc: "wind · atem · thermik",
  variants: [

  { id: "wind", name: "Wind", desc: "rauschen · böen · hauch-pad",
    xyLabels: ["helligkeit", "windstärke"], xyDefault: [0.45, 0.5], melodyDefault: 0.25,
    build(bus) {
      const noise = new Tone.Noise("pink").start();
      const filt  = new Tone.Filter(600, "bandpass"); filt.Q.value = 1.4;
      const nGain = new Tone.Gain(0.4);
      noise.chain(filt, nGain, bus);
      const gust = new Tone.LFO(0.08, 300, 900).start();
      gust.connect(filt.frequency);
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 2.5, decay: 1, sustain: 0.6, release: 6 }, volume: -12,
      });
      pad.maxPolyphony = 4; pad.connect(bus);
      return {
        setXY(x, y) {
          const c = 200 + x * 2400;
          gust.min = c * 0.6; gust.max = c * 1.7;
          nGain.gain.rampTo(0.04 + y * 0.75, 0.1);
        },
        macro: { label: "böen", default: 0.3,
          set(v) { gust.frequency.rampTo(0.02 + v * 0.9, 0.2); } },
        params: [
          { label: "schärfe", default: 0.15, set(v) { filt.Q.rampTo(0.3 + v * 10, 0.1); } },
          { label: "pad", default: 0.5, set(v) { pad.volume.rampTo(-30 + v * 24, 0.1); } },
          // 0 = Wind steht konstant (voll von Hand/Kabel steuerbar), 1 = volle Böen
          { label: "böen-tiefe", default: 1, set(v) { gust.amplitude.rampTo(v, 0.2); } },
        ],
        melodic: { synth: pad, interval: "2n", dur: "1n", baseOct: 2, octaves: 2, vel: 0.45 },
        dispose() { [noise, filt, nGain, gust, pad].forEach(n => n.dispose()); },
      };
    } },

  { id: "atem", name: "Atem", desc: "ein · aus · der körper als blasebalg",
    xyLabels: ["atemtempo", "atemtiefe"], xyDefault: [0.35, 0.55], melodyDefault: 0.2,
    build(bus) {
      const noise = new Tone.Noise("pink").start();
      const filt  = new Tone.Filter(700, "lowpass");
      const breathGain = new Tone.Gain(0.2);
      noise.chain(filt, breathGain, bus);
      const breath = new Tone.LFO(0.1, 0.02, 0.6).start();   // Ein/Aus-Zyklus
      breath.connect(breathGain.gain);
      const drift = new Tone.LFO(0.13, 350, 900).start();    // Unruhe im Filter
      drift.connect(filt.frequency);
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 1.5, decay: 2, sustain: 0.3, release: 7 }, volume: -14,
      });
      pad.maxPolyphony = 3; pad.connect(bus);
      return {
        setXY(x, y) {
          breath.frequency.rampTo(0.03 + x * 0.35, 0.3);
          breath.max = 0.1 + y * 0.85;
        },
        macro: { label: "wärme", default: 0.4,
          set(v) { const lo = 250 + v * 1400; drift.min = lo; drift.max = lo * 2.2; } },
        params: [
          { label: "unruhe", default: 0.3, set(v) { drift.amplitude.rampTo(v, 0.2); } },
          { label: "seufzer", default: 0.4, set(v) { pad.volume.rampTo(-30 + v * 22, 0.1); } },
          // 0 = Atem hält die Luft (konstanter Strom), 1 = voller Ein/Aus-Zyklus
          { label: "zyklus", default: 1, set(v) { breath.amplitude.rampTo(v, 0.3); } },
        ],
        melodic: { synth: pad, interval: "1n", dur: "1n", baseOct: 2, octaves: 1, vel: 0.4, bias: -0.4 },
        dispose() { [noise, filt, breathGain, breath, drift, pad].forEach(n => n.dispose()); },
      };
    } },

  { id: "thermik", name: "Thermik", desc: "aufsteigende gleitflüge · warme säulen",
    xyLabels: ["gleiten", "flughöhe"], xyDefault: [0.5, 0.4], melodyDefault: 0.5,
    build(bus) {
      const voice = new Tone.Synth({                          // mono → echtes Gleiten
        portamento: 0.4, oscillator: { type: "sine" },
        envelope: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 3 }, volume: -10,
      });
      const filt = new Tone.Filter(2200, "lowpass");
      voice.chain(filt, bus);
      const air = new Tone.Noise("white").start();
      const airF = new Tone.Filter(5000, "highpass");
      const airG = new Tone.Gain(0.015);
      air.chain(airF, airG, bus);
      const melodic = { synth: voice, interval: "2n", dur: 1.6, baseOct: 2,
                        octaves: 2, vel: 0.55, bias: 0.85, wrap: true };
      return {
        setXY(x, y) {
          voice.portamento = 0.05 + x * 1.3;
          melodic.baseOct = 1 + Math.round(y * 2);
        },
        macro: { label: "hauch", default: 0.2,
          set(v) { airG.gain.rampTo(v * 0.12, 0.1); } },
        params: [
          { label: "kühle", default: 0.6, set(v) { filt.frequency.rampTo(500 + v * 4500, 0.2); } },
          { label: "sog", default: 0.85, set(v) { melodic.bias = v; } },
        ],
        melodic,
        dispose() { [voice, filt, air, airF, airG].forEach(n => n.dispose()); },
      };
    } },

  { id: "chor", name: "Chor", desc: "atmende akkord-flächen · gewählte folge",
    xyLabels: ["weichheit", "lage"], xyDefault: [0.55, 0.5], melodyDefault: 0.3,
    build(bus) {
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 2.2, decay: 1, sustain: 0.7, release: 6 }, volume: -14,
      });
      pad.maxPolyphony = 12;
      const lp = new Tone.Filter(2500, "lowpass");
      pad.chain(lp, bus);
      const breath = new Tone.Noise("pink").start();
      const bf = new Tone.Filter(900, "bandpass");
      const bg = new Tone.Gain(0);
      breath.chain(bf, bg, bus);
      const chordal = {
        synth: pad, interval: "2n", dur: "1n", baseOct: 2, octaves: 1, vel: 0.3,
        pattern: "auf", wechsel: 8, defaultChords: ["i", "VI", "III", "VII"],
        onChord(tones, time) {                    // Akkordwechsel = neuer Atemzug
          tones.forEach((mm, i) => {
            try { pad.triggerAttackRelease(
              Tone.Frequency(mm, "midi").toFrequency(), 6, time + i * 0.15, 0.4); } catch (e) {}
          });
        },
      };
      return {
        setXY(x, y) {
          pad.set({ envelope: { attack: 0.4 + x * 4.5, release: 3 + x * 6 } });
          chordal.baseOct = 1 + Math.round(y * 2);
        },
        macro: { label: "atem", default: 0.15, set(v) { bg.gain.rampTo(v * 0.25, 0.1); } },
        params: [
          { label: "fülle", default: 0, set(v) { chordal.octaves = 1 + Math.round(v); } },
          { label: "glanz", default: 0.55, set(v) { lp.frequency.rampTo(800 + v * 5200, 0.2); } },
        ],
        chordal,
        dispose() { [pad, lp, breath, bf, bg].forEach(n => n.dispose()); },
      };
    } },

  { id: "vogelzug", name: "Vogelzug", desc: "pfeifende motive ziehen am himmel vorbei",
    xyLabels: ["zugbahn", "flughöhe"], xyDefault: [0.5, 0.6], melodyDefault: 0.65,
    build(bus) {
      const whistle = new Tone.Synth({
        portamento: 0.04, oscillator: { type: "sine" },
        envelope: { attack: 0.06, decay: 0.25, sustain: 0.5, release: 0.5 }, volume: -10,
      });
      const vib = new Tone.Vibrato(5.5, 0.12);
      const pan = new Tone.Panner(0);
      whistle.chain(vib, pan, bus);
      const air = new Tone.Noise("pink").start();
      const af = new Tone.Filter(2500, "bandpass");
      const ag = new Tone.Gain(0.01);
      air.chain(af, ag, bus);
      const motif = { synth: whistle, interval: "8n", baseOct: 4, octaves: 1,
                      vel: 0.5, phraseLen: 5, variation: 0.4, restBase: 3 };
      return {
        setXY(x, y) {
          pan.pan.rampTo((x - 0.5) * 1.6, 0.2);          // wo am Himmel der Zug fliegt
          motif.baseOct = 3 + Math.round(y * 2);
        },
        macro: { label: "triller", default: 0.25, set(v) { vib.depth.rampTo(v * 0.6, 0.1); } },
        params: [
          { label: "hauch", default: 0.2, set(v) { ag.gain.rampTo(v * 0.08, 0.1); } },
          { label: "biegung", default: 0.2, set(v) { whistle.portamento = v * 0.25; } },
        ],
        motif,
        dispose() { [whistle, vib, pan, air, af, ag].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ ECHOORTUNG ═════════════════════════════════════════════════ */
{
  id: "echo", name: "Echoortung", color: "#9d7bff",
  desc: "pings · chirps · schwärme",
  variants: [

  { id: "ping", name: "Ping", desc: "fm-rufe · der raum antwortet",
    xyLabels: ["raumgröße", "flughöhe"], xyDefault: [0.4, 0.6], melodyDefault: 0.55,
    build(bus) {
      const ping = new Tone.FMSynth({
        harmonicity: 2.5, modulationIndex: 14,
        envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.002, decay: 0.06, sustain: 0 }, volume: -6,
      });
      const dly = new Tone.FeedbackDelay({ delayTime: 0.28, feedback: 0.55, wet: 0.7 });
      ping.chain(dly, bus);
      const melodic = { synth: ping, interval: "8n", dur: "16n", baseOct: 3, octaves: 2, vel: 0.6 };
      return {
        setXY(x, y) {
          dly.delayTime.rampTo(0.06 + x * 0.55, 0.2);
          melodic.baseOct = 2 + Math.round(y * 2);
        },
        macro: { label: "echo", default: 0.55, set(v) { dly.feedback.rampTo(v * 0.85, 0.1); } },
        params: [
          { label: "biss", default: 0.5, set(v) { ping.modulationIndex.rampTo(2 + v * 24, 0.1); } },
          { label: "metall", default: 0.4, set(v) { ping.harmonicity.rampTo(1 + v * 3.5, 0.1); } },
        ],
        melodic,
        dispose() { [ping, dly].forEach(n => n.dispose()); },
      };
    } },

  { id: "chirp", name: "Chirp", desc: "fallende sweeps · fledermaus-rufe",
    xyLabels: ["fallweite", "raumgröße"], xyDefault: [0.55, 0.35], melodyDefault: 0.45,
    build(bus) {
      const chirp = new Tone.MembraneSynth({
        pitchDecay: 0.09, octaves: 5,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.28, sustain: 0 }, volume: -6,
      });
      const dly = new Tone.FeedbackDelay({ delayTime: 0.22, feedback: 0.4, wet: 0.6 });
      chirp.chain(dly, bus);
      return {
        setXY(x, y) {
          chirp.octaves = 1 + x * 8;                          // wie weit der Ruf fällt
          dly.delayTime.rampTo(0.06 + y * 0.5, 0.2);
        },
        macro: { label: "echo", default: 0.4, set(v) { dly.feedback.rampTo(v * 0.85, 0.1); } },
        params: [
          { label: "fallzeit", default: 0.25, set(v) { chirp.pitchDecay = 0.01 + v * 0.4; } },
          { label: "nachhall", default: 0.4, set(v) { chirp.envelope.decay = 0.05 + v * 0.7; } },
        ],
        melodic: { synth: chirp, interval: "4n", dur: "8n", baseOct: 3, octaves: 2, vel: 0.6 },
        dispose() { [chirp, dly].forEach(n => n.dispose()); },
      };
    } },

  { id: "schwarm", name: "Schwarm", desc: "tausend klicks · körnige wolke",
    xyLabels: ["streuung", "tonlage"], xyDefault: [0.5, 0.5], melodyDefault: null,
    build(bus) {
      const click = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0 }, volume: -8,
      });
      const bp = new Tone.Filter(4000, "bandpass"); bp.Q.value = 3;
      const pan = new Tone.AutoPanner({ frequency: 3, depth: 0.9 }).start();
      click.chain(bp, pan, bus);
      const loop = new Tone.Loop((t) => {
        try { click.triggerAttackRelease(0.03, t, 0.3 + Math.random() * 0.5); } catch (e) {}
      }, "16n").start(0);
      loop.probability = 0.5;
      return {
        setXY(x, y) {
          pan.frequency.rampTo(0.3 + x * 8, 0.2);             // wie wild der Schwarm kreist
          bp.frequency.rampTo(800 + y * 7000, 0.15);
        },
        macro: { label: "dichte", default: 0.5, set(v) { loop.probability = v; } },
        params: [
          { label: "körnung", default: 0.3, set(v) { click.envelope.decay = 0.008 + v * 0.09; } },
          { label: "flattern", default: 0.9, set(v) { pan.depth.rampTo(v, 0.1); } },
          { label: "eile", default: 0.5, set(v) { loop.interval = ["8n", "16n", "32n"][Math.floor(v * 2.999)]; } },
        ],
        dispose() { loop.dispose(); [click, bp, pan].forEach(n => n.dispose()); },
      };
    } },

  { id: "kaskade", name: "Kaskade", desc: "akkord-pings stürzen durchs echo",
    xyLabels: ["raumgröße", "flughöhe"], xyDefault: [0.45, 0.55], melodyDefault: 0.6,
    build(bus) {
      const ping = new Tone.FMSynth({
        harmonicity: 2, modulationIndex: 10,
        envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.002, decay: 0.07, sustain: 0 }, volume: -8,
      });
      const dly = new Tone.FeedbackDelay({ delayTime: 0.26, feedback: 0.5, wet: 0.65 });
      ping.chain(dly, bus);
      const chordal = {
        synth: ping, interval: "8n", dur: "16n", baseOct: 3, octaves: 2, vel: 0.55,
        pattern: "ab", wechsel: 5, defaultChords: ["i", "VI", "VII"],
      };
      return {
        setXY(x, y) {
          dly.delayTime.rampTo(0.06 + x * 0.5, 0.2);
          chordal.baseOct = 2 + Math.round(y * 2);
        },
        macro: { label: "echo", default: 0.5, set(v) { dly.feedback.rampTo(v * 0.85, 0.1); } },
        params: [
          { label: "biss", default: 0.4, set(v) { ping.modulationIndex.rampTo(2 + v * 22, 0.1); } },
          { label: "metall", default: 0.35, set(v) { ping.harmonicity.rampTo(1 + v * 3.5, 0.1); } },
        ],
        chordal,
        dispose() { [ping, dly].forEach(n => n.dispose()); },
      };
    } },

  { id: "rufe", name: "Rufe", desc: "ein motiv ruft — das echo antwortet",
    xyLabels: ["antwortzeit", "rufhöhe"], xyDefault: [0.45, 0.5], melodyDefault: 0.6,
    build(bus) {
      const call = new Tone.FMSynth({
        harmonicity: 1.5, modulationIndex: 6,
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.6 },
        modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0 }, volume: -8,
      });
      const dly = new Tone.FeedbackDelay({ delayTime: 0.35, feedback: 0.55, wet: 0.6 });
      call.chain(dly, bus);
      const motif = { synth: call, interval: "8n", baseOct: 3, octaves: 2,
                      vel: 0.55, phraseLen: 4, variation: 0.35, restBase: 4 };
      return {
        setXY(x, y) {
          dly.delayTime.rampTo(0.12 + x * 0.6, 0.2);
          motif.baseOct = 2 + Math.round(y * 2);
        },
        macro: { label: "echo", default: 0.55, set(v) { dly.feedback.rampTo(v * 0.85, 0.1); } },
        params: [
          { label: "biss", default: 0.3, set(v) { call.modulationIndex.rampTo(1 + v * 16, 0.1); } },
          { label: "weichheit", default: 0.4, set(v) { call.envelope.decay = 0.15 + v * 0.8; } },
        ],
        motif,
        dispose() { [call, dly].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ MOTION ═════════════════════════════════════════════════════ */
{
  id: "motion", name: "Motion", color: "#ffb25c",
  desc: "druckwellen · puls · beben",
  variants: [

  { id: "druck", name: "Druckwelle", desc: "sub-drone · walkende wellen",
    xyLabels: ["wellentempo", "tiefe"], xyDefault: [0.25, 0.4], melodyDefault: null,
    build(bus) {
      let base = 55;
      const o1 = new Tone.Oscillator(base, "sine").start(); o1.volume.value = -10;
      const o2 = new Tone.Oscillator(base * 1.005, "triangle").start(); o2.volume.value = -16;
      const wob = new Tone.AutoFilter({ frequency: 0.12, baseFrequency: 45, octaves: 2.5, depth: 0.85 }).start();
      const dist = new Tone.Distortion(0.05); dist.wet.value = 0.2;
      o1.connect(wob); o2.connect(wob); wob.chain(dist, bus);
      return {
        setXY(x, y) {
          wob.frequency.rampTo(0.03 + x * 1.8, 0.2);
          base = 100 - y * 65;
          o1.frequency.rampTo(base, 0.5); o2.frequency.rampTo(base * 1.005, 0.5);
        },
        macro: { label: "druck", default: 0.2,
          set(v) { dist.distortion = v * 0.6; dist.wet.rampTo(0.1 + v * 0.6, 0.1); } },
        params: [
          { label: "wellenhub", default: 0.6, set(v) { wob.octaves = 1 + v * 3.5; } },
          { label: "zweitstimme", default: 0.4, set(v) { o2.volume.rampTo(-34 + v * 26, 0.1); } },
        ],
        dispose() { [o1, o2, wob, dist].forEach(n => n.dispose()); },
      };
    } },

  { id: "puls", name: "Puls", desc: "herzschlag · lub-dub im bauch",
    xyLabels: ["herztempo", "tiefe"], xyDefault: [0.35, 0.5], melodyDefault: null,
    build(bus) {
      const drum = new Tone.MembraneSynth({
        pitchDecay: 0.06, octaves: 2.5,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0 }, volume: -4,
      });
      drum.connect(bus);
      let pitch = 45, dub = 0.55;
      const loop = new Tone.Loop((t) => {
        try {
          drum.triggerAttackRelease(pitch, "8n", t, 0.9);            // lub
          drum.triggerAttackRelease(pitch * 0.92, "8n", t + loop.interval * 0.22, 0.9 * dub); // dub
        } catch (e) {}
      }, 1.1).start(0);
      return {
        setXY(x, y) {
          loop.interval = 1.7 - x * 1.25;                     // 1.7s .. 0.45s
          pitch = 30 + (1 - y) * 0 + y * 45;                  // 30..75 Hz
        },
        macro: { label: "doppelschlag", default: 0.55, set(v) { dub = v; } },
        params: [
          { label: "haut", default: 0.3, set(v) { drum.pitchDecay = 0.02 + v * 0.2; } },
          { label: "nachklang", default: 0.5, set(v) { drum.envelope.decay = 0.1 + v * 0.9; } },
        ],
        dispose() { loop.dispose(); drum.dispose(); },
      };
    } },

  { id: "beben", name: "Beben", desc: "grollen · zufällige erschütterungen",
    xyLabels: ["erschütterung", "grundtiefe"], xyDefault: [0.4, 0.4], melodyDefault: null,
    build(bus) {
      const noise = new Tone.Noise("brown").start();
      const filt = new Tone.Filter(120, "lowpass");
      const g = new Tone.Gain(0.6);
      noise.chain(filt, g, bus);
      let prob = 0.3, punch = 0.5, tail = 0.6;
      const loop = new Tone.Loop((t) => {
        if (Math.random() > prob) return;
        try {
          // Erdstoß: Filter reißt kurz auf und schließt wieder
          const peak = filt.frequency.value * (2 + punch * 5);
          filt.frequency.cancelScheduledValues(t);
          filt.frequency.setValueAtTime(filt.frequency.value, t);
          filt.frequency.linearRampToValueAtTime(peak, t + 0.05);
          filt.frequency.exponentialRampToValueAtTime(60 + 40, t + 0.05 + 0.2 + tail * 1.5);
        } catch (e) { /* Layer wurde gerade entsorgt */ }
      }, 0.5).start(0);
      return {
        setXY(x, y) { prob = x; filt.frequency.rampTo(60 + y * 240, 0.3); },
        macro: { label: "grollen", default: 0.6, set(v) { g.gain.rampTo(v, 0.1); } },
        params: [
          { label: "härte", default: 0.5, set(v) { punch = v; } },
          { label: "nachbeben", default: 0.6, set(v) { tail = v; } },
        ],
        dispose() { loop.dispose(); [noise, filt, g].forEach(n => n.dispose()); },
      };
    } },

  { id: "gangart", name: "Gangart", desc: "bass-motive wie ein schrittmuster",
    xyLabels: ["knack", "lauflage"], xyDefault: [0.5, 0.35], melodyDefault: 0.7,
    build(bus) {
      const bass = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.004, decay: 0.25, sustain: 0.15, release: 0.3 },
        filter: { Q: 3, type: "lowpass" },
        filterEnvelope: { attack: 0.004, decay: 0.14, sustain: 0.15,
                          baseFrequency: 70, octaves: 2.6 },
        volume: -8,
      });
      bass.connect(bus);
      const motif = { synth: bass, interval: "8n", baseOct: 1, octaves: 1, vel: 0.8,
                      phraseLen: 4, variation: 0.15, maxRepeats: 6, restBase: 2 };
      return {
        setXY(x, y) {
          bass.filterEnvelope.octaves = 1 + x * 4;       // wie hart der Schritt knackt
          motif.baseOct = Math.round(y * 2);
        },
        macro: { label: "schwere", default: 0.3,
          set(v) { bass.filterEnvelope.baseFrequency = 40 + v * 260; } },
        params: [
          { label: "griff", default: 0.4, set(v) { bass.filter.Q.rampTo(0.5 + v * 10, 0.1); } },
          { label: "federung", default: 0.3, set(v) { bass.envelope.release = 0.08 + v * 0.9; } },
        ],
        motif,
        dispose() { bass.dispose(); },
      };
    } },
  ],
},

/* ══ INFRAROT ═══════════════════════════════════════════════════ */
{
  id: "infrarot", name: "Infrarot", color: "#ff4d2e",
  desc: "wärme · glühen · tiefe strahlung",
  variants: [

  { id: "glut", name: "Glut", desc: "warmer drone · flimmernde hitze",
    xyLabels: ["wärmeflimmern", "strahlung"], xyDefault: [0.42, 0.55], melodyDefault: 0.28,
    build(bus) {
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 2.2, decay: 1.4, sustain: 0.72, release: 6.5 }, volume: -13,
      });
      pad.maxPolyphony = 5;
      const filt = new Tone.Filter(900, "lowpass"); filt.Q.value = 0.8;
      const trem = new Tone.Tremolo({ frequency: 0.18, depth: 0.25 }).start();
      const heat = new Tone.Noise("brown").start();
      const heatF = new Tone.Filter(180, "lowpass");
      const heatG = new Tone.Gain(0.08);
      pad.chain(filt, trem, bus);
      heat.chain(heatF, heatG, bus);
      const melodic = { synth: pad, interval: "1n", dur: "1n", baseOct: 1,
                        octaves: 2, vel: 0.38, bias: -0.2 };
      return {
        setXY(x, y) {
          trem.frequency.rampTo(0.04 + x * 1.1, 0.25);
          filt.frequency.rampTo(220 + y * 2400, 0.2);
          heatF.frequency.rampTo(60 + y * 420, 0.2);
          melodic.baseOct = 1 + Math.round(y * 2);
        },
        macro: { label: "glut", default: 0.45,
          set(v) { heatG.gain.rampTo(v * 0.22, 0.12); } },
        params: [
          { label: "flimmern", default: 0.35, set(v) { trem.depth.rampTo(v * 0.85, 0.12); } },
          { label: "oberwärme", default: 0.45, set(v) { filt.Q.rampTo(0.4 + v * 5, 0.12); } },
        ],
        melodic,
        dispose() { [pad, filt, trem, heat, heatF, heatG].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ LICHTSPEKTREN ══════════════════════════════════════════════ */
{
  id: "licht", name: "Lichtspektren", color: "#ff6fb5",
  desc: "schimmern · prisma · polarlicht",
  variants: [

  { id: "schimmer", name: "Schimmer", desc: "gläserne obertöne · uv-kippen",
    xyLabels: ["spektral-kippung", "schimmer-tempo"], xyDefault: [0.55, 0.35], melodyDefault: 0.4,
    build(bus) {
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine4" },
        envelope: { attack: 1.8, decay: 1.5, sustain: 0.5, release: 7 }, volume: -14,
      });
      pad.maxPolyphony = 5;
      const ph = new Tone.Phaser({ frequency: 0.4, octaves: 2.5, baseFrequency: 400 });
      const eq = new Tone.EQ3();
      pad.chain(ph, eq, bus);
      return {
        setXY(x, y) {
          eq.low.rampTo((0.5 - x) * 18, 0.1);
          eq.high.rampTo((x - 0.5) * 18, 0.1);
          ph.frequency.rampTo(0.05 + y * 2.5, 0.2);
        },
        macro: { label: "glanz", default: 0.5, set(v) { ph.octaves = v * 5; } },
        params: [
          { label: "teiltöne", default: 0.5,
            set(v) { pad.set({ oscillator: { type: "sine" + (1 + Math.round(v * 7)) } }); } },
          { label: "farbzentrum", default: 0.3,
            set(v) { ph.baseFrequency = 100 + v * 1400; } },
        ],
        melodic: { synth: pad, interval: "2n", dur: "1n", baseOct: 3, octaves: 2, vel: 0.4 },
        dispose() { [pad, ph, eq].forEach(n => n.dispose()); },
      };
    } },

  { id: "prisma", name: "Prisma", desc: "licht bricht in funken · schnelle splitter",
    xyLabels: ["brechung", "funkeln"], xyDefault: [0.4, 0.4], melodyDefault: 0.5,
    build(bus) {
      const spark = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.2 }, volume: -10,
      });
      spark.maxPolyphony = 8;
      const dly = new Tone.FeedbackDelay({ delayTime: 0.19, feedback: 0.35, wet: 0.45 });
      const hp = new Tone.Filter(600, "highpass");
      spark.chain(hp, dly, bus);
      return {
        setXY(x, y) {
          dly.delayTime.rampTo(0.08 + x * 0.35, 0.2);
          dly.wet.rampTo(0.15 + x * 0.6, 0.1);
          spark.set({ envelope: { decay: 0.05 + y * 0.4 } });
        },
        macro: { label: "splitter", default: 0.35, set(v) { dly.feedback.rampTo(v * 0.8, 0.1); } },
        params: [
          { label: "kante", default: 0.1, set(v) { spark.set({ envelope: { attack: 0.001 + v * 0.08 } }); } },
          { label: "kälte", default: 0.4, set(v) { hp.frequency.rampTo(200 + v * 2800, 0.2); } },
        ],
        melodic: { synth: spark, interval: "16n", dur: "16n", baseOct: 4, octaves: 2, vel: 0.5 },
        dispose() { [spark, dly, hp].forEach(n => n.dispose()); },
      };
    } },

  { id: "polarlicht", name: "Polarlicht", desc: "langsam wandernde farbvorhänge",
    xyLabels: ["farbwandel", "höhenschleier"], xyDefault: [0.35, 0.55], melodyDefault: null,
    build(bus, engine) {
      const pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine2" },
        envelope: { attack: 3.5, decay: 2, sustain: 0.6, release: 9 }, volume: -16,
      });
      pad.maxPolyphony = 10;
      const ch = new Tone.Chorus({ frequency: 0.3, delayTime: 6, depth: 0.6, wet: 0.6 }).start();
      const lp = new Tone.Filter(3000, "lowpass");
      pad.chain(ch, lp, bus);
      let voices = 4, detune = 8;
      const loop = new Tone.Loop((t) => {
        // Akkord-Vorhang aus der Welt-Skala: Grundton + gestapelte Terzen
        const w = engine.world, sc = w.scale;
        const start = Math.floor(Math.random() * sc.length);
        for (let i = 0; i < voices; i++) {
          const deg = start + i * 2;
          const midi = w.rootMidi + 24 + Math.floor(deg / sc.length) * 12 + sc[deg % sc.length];
          const f = Tone.Frequency(midi, "midi").toFrequency()
                    * Math.pow(2, (Math.random() * 2 - 1) * detune / 1200);
          try { pad.triggerAttackRelease(f, 7, t + i * 0.35, 0.35); } catch (e) {}
        }
      }, 9).start(0.5);
      return {
        setXY(x, y) {
          ch.frequency.rampTo(0.05 + x * 1.5, 0.2);
          ch.depth = 0.2 + x * 0.7;
          lp.frequency.rampTo(600 + y * 6000, 0.3);
        },
        macro: { label: "vorhangwechsel", default: 0.4, set(v) { loop.interval = 16 - v * 12; } },
        params: [
          { label: "stimmen", default: 0.4, set(v) { voices = 3 + Math.round(v * 3); } },
          { label: "schwebung", default: 0.25, set(v) { detune = v * 35; } },
        ],
        dispose() { loop.dispose(); [pad, ch, lp].forEach(n => n.dispose()); },
      };
    } },

  { id: "facetten", name: "Facetten", desc: "licht bricht durch akkord-flächen",
    xyLabels: ["brechung", "funkeln"], xyDefault: [0.4, 0.4], melodyDefault: 0.55,
    build(bus) {
      const spark = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.2 }, volume: -10,
      });
      spark.maxPolyphony = 8;
      const hp = new Tone.Filter(700, "highpass");
      const dly = new Tone.FeedbackDelay({ delayTime: 0.17, feedback: 0.3, wet: 0.4 });
      spark.chain(hp, dly, bus);
      const chordal = {
        synth: spark, interval: "16n", dur: "16n", baseOct: 4, octaves: 2, vel: 0.5,
        pattern: "pendel", wechsel: 4, defaultChords: ["i", "III", "VII", "sus"],
      };
      return {
        setXY(x, y) {
          dly.delayTime.rampTo(0.08 + x * 0.32, 0.2);
          dly.wet.rampTo(0.15 + x * 0.55, 0.1);
          spark.set({ envelope: { decay: 0.05 + y * 0.35 } });
        },
        macro: { label: "splitter", default: 0.3, set(v) { dly.feedback.rampTo(v * 0.8, 0.1); } },
        params: [
          { label: "kante", default: 0.1, set(v) { spark.set({ envelope: { attack: 0.001 + v * 0.08 } }); } },
          { label: "kälte", default: 0.4, set(v) { hp.frequency.rampTo(200 + v * 2800, 0.2); } },
        ],
        chordal,
        dispose() { [spark, hp, dly].forEach(n => n.dispose()); },
      };
    } },

  { id: "glasspiel", name: "Glasspiel", desc: "glockige motive wie licht auf glas",
    xyLabels: ["glanz", "nachklang"], xyDefault: [0.5, 0.5], melodyDefault: 0.6,
    build(bus) {
      const bell = new Tone.FMSynth({
        harmonicity: 5.07, modulationIndex: 9,
        envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 1.8 },
        modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0 }, volume: -12,
      });
      const lp = new Tone.Filter(6000, "lowpass");
      bell.chain(lp, bus);
      const motif = { synth: bell, interval: "4n", baseOct: 4, octaves: 2,
                      vel: 0.5, phraseLen: 5, variation: 0.45, restBase: 3 };
      return {
        setXY(x, y) {
          bell.harmonicity.rampTo(1.5 + x * 7, 0.1);
          bell.envelope.decay = 0.4 + y * 2.5;
          bell.envelope.release = 0.5 + y * 3;
        },
        macro: { label: "helle", default: 0.7, set(v) { lp.frequency.rampTo(1000 + v * 8000, 0.2); } },
        params: [
          { label: "farbe", default: 0.4, set(v) { bell.modulationIndex.rampTo(2 + v * 20, 0.1); } },
          { label: "anschlag", default: 0.05, set(v) { bell.envelope.attack = 0.001 + v * 0.1; } },
        ],
        motif,
        dispose() { [bell, lp].forEach(n => n.dispose()); },
      };
    } },

  { id: "spieluhr", name: "Spieluhr", desc: "⟳ gelockte glöckchen-schleife, die sich wandelt",
    xyLabels: ["helligkeit", "lage"], xyDefault: [0.5, 0.6], melodyDefault: 0.7,
    build(bus) {
      const bell = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 4, modulationIndex: 9,
        oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 1.3 },
        modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.3 },
        volume: -14,
      });
      bell.maxPolyphony = 6;
      const lp = new Tone.Filter(3500, "lowpass");
      bell.chain(lp, bus);
      const turing = { synth: bell, interval: "8n", dur: 0.4,
                       baseOct: 3, octaves: 2, vel: 0.5, len: 8, mutate: 0.12 };
      return {
        setXY(x, y) {
          lp.frequency.rampTo(700 + x * 6500, 0.1);
          turing.baseOct = 2 + Math.round(y * 2);
        },
        macro: { label: "nachklang", default: 0.4,
          set(v) { bell.set({ envelope: { decay: 0.3 + v * 2.2, release: 0.4 + v * 2.6 } }); } },
        params: [
          { label: "glanz", default: 0.5, set(v) { bell.set({ modulationIndex: 2 + v * 16 }); } },
          { label: "härte", default: 0.3, set(v) { bell.set({ harmonicity: 1 + Math.round(v * 7) }); } },
        ],
        turing,
        dispose() { [bell, lp].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ CHEMISCHE WAHRNEHMUNG ══════════════════════════════════════ */
{
  id: "chemie", name: "Chemische Wahrnehmung", color: "#7fe89b",
  desc: "duftwolken · gärung · spuren",
  variants: [

  { id: "duft", name: "Duftwolke", desc: "klang diffundiert wie geruch im raum",
    xyLabels: ["schärfe", "diffusion"], xyDefault: [0.3, 0.6], melodyDefault: 0.3,
    build(bus) {
      const syn = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 4, decay: 2, sustain: 0.5, release: 9 }, volume: -12,
      });
      syn.maxPolyphony = 8;
      const filt = new Tone.Filter(900, "lowpass"); filt.Q.value = 0.8;
      syn.chain(filt, bus);
      const melodic = { synth: syn, interval: "1n", dur: "1n", baseOct: 2, octaves: 2,
                        vel: 0.45, cluster: true, clusterCents: 18 };
      return {
        setXY(x, y) {
          melodic.clusterCents = 6 + x * 80;
          filt.Q.rampTo(0.5 + x * 6, 0.2);
          syn.set({ envelope: { attack: 1 + y * 7, release: 3 + y * 12 } });
        },
        macro: { label: "dunst", default: 0.4, set(v) { filt.frequency.rampTo(300 + v * 3700, 0.2); } },
        params: [
          { label: "schwere", default: 0.3,
            set(v) { syn.set({ oscillator: { type: v < 0.5 ? "triangle" : "sawtooth" } }); } },
          { label: "körper", default: 0.5, set(v) { syn.volume.rampTo(-22 + v * 14, 0.1); } },
        ],
        melodic,
        dispose() { [syn, filt].forEach(n => n.dispose()); },
      };
    } },

  { id: "gaerung", name: "Gärung", desc: "blubbernde blasen · lebendiger bodensatz",
    xyLabels: ["brodeln", "trübung"], xyDefault: [0.5, 0.4], melodyDefault: null,
    build(bus, engine) {
      const blip = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.004, decay: 0.09, sustain: 0, release: 0.1 }, volume: -8,
      });
      blip.maxPolyphony = 6;
      const lp = new Tone.Filter(1200, "lowpass");
      const dly = new Tone.FeedbackDelay({ delayTime: 0.09, feedback: 0.3, wet: 0.4 });
      blip.chain(lp, dly, bus);
      let range = 2;
      const loop = new Tone.Loop((t) => {
        // Blasen steigen zufällig aus der Welt-Skala auf (tiefe Lage)
        const w = engine.world, sc = w.scale;
        const deg = Math.floor(Math.random() * sc.length * range);
        const midi = w.rootMidi + Math.floor(deg / sc.length) * 12 + sc[deg % sc.length];
        try { blip.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(),
              0.08, t + Math.random() * 0.08, 0.3 + Math.random() * 0.5); } catch (e) {}
      }, "16n").start(0);
      loop.probability = 0.45;
      return {
        setXY(x, y) { loop.probability = x * 0.9; lp.frequency.rampTo(300 + y * 3500, 0.2); },
        macro: { label: "blasengröße", default: 0.25,
          set(v) { blip.set({ envelope: { decay: 0.03 + v * 0.4 } }); } },
        params: [
          { label: "gluckern", default: 0.3, set(v) { dly.feedback.rampTo(v * 0.75, 0.1); } },
          { label: "steighöhe", default: 0.5, set(v) { range = 1 + v * 2.5; } },
        ],
        dispose() { loop.dispose(); [blip, lp, dly].forEach(n => n.dispose()); },
      };
    } },

  { id: "spur", name: "Pheromonspur", desc: "eine stimme legt eine lange fährte",
    xyLabels: ["spurlänge", "süße"], xyDefault: [0.6, 0.5], melodyDefault: 0.4,
    build(bus) {
      const voice = new Tone.Synth({
        portamento: 0.8, oscillator: { type: "sine" },
        envelope: { attack: 0.4, decay: 0.5, sustain: 0.7, release: 2 }, volume: -10,
      });
      const lp = new Tone.Filter(1800, "lowpass");
      const trail = new Tone.FeedbackDelay({ delayTime: 0.45, feedback: 0.7, wet: 0.6 });
      voice.chain(lp, trail, bus);
      return {
        setXY(x, y) {
          trail.feedback.rampTo(0.2 + x * 0.72, 0.15);
          lp.frequency.rampTo(500 + y * 4000, 0.2);
        },
        macro: { label: "verwischen", default: 0.6, set(v) { trail.wet.rampTo(v * 0.9, 0.1); } },
        params: [
          { label: "zähigkeit", default: 0.4, set(v) { voice.portamento = 0.05 + v * 2; } },
          { label: "fährtenabstand", default: 0.55, set(v) { trail.delayTime.rampTo(0.1 + v * 0.7, 0.2); } },
        ],
        melodic: { synth: voice, interval: "1n", dur: 2.2, baseOct: 2, octaves: 2, vel: 0.5 },
        dispose() { [voice, lp, trail].forEach(n => n.dispose()); },
      };
    } },

  { id: "bindung", name: "Verbindungen", desc: "stimmen rasten gleitend in akkorde ein",
    xyLabels: ["zähigkeit", "klarheit"], xyDefault: [0.5, 0.55], melodyDefault: 0.25,
    build(bus) {
      const mkV = () => new Tone.Synth({
        portamento: 0.8, oscillator: { type: "sine" },
        envelope: { attack: 1.5, decay: 0.5, sustain: 0.9, release: 4 }, volume: -16,
      });
      const voices = [mkV(), mkV(), mkV()];        // die "Bindungen"
      const lp = new Tone.Filter(1600, "lowpass");
      voices.forEach(v => v.connect(lp)); lp.connect(bus);
      const blip = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.14, sustain: 0 }, volume: -16,
      });
      blip.maxPolyphony = 4; blip.connect(lp);
      let held = false;
      const chordal = {
        synth: blip, interval: "4n", dur: "8n", baseOct: 3, octaves: 1, vel: 0.4,
        pattern: "zufall", wechsel: 7, defaultChords: ["i", "iv", "VI"],
        onChord(tones, time) {                     // Moleküle gleiten zur neuen Bindung
          tones.slice(0, 3).forEach((mm, i) => {
            const f = Tone.Frequency(mm - 12, "midi").toFrequency();
            try {
              if (!held) voices[i].triggerAttack(f, time, 0.5);
              else voices[i].setNote(f, time);
            } catch (e) {}
          });
          held = true;
        },
      };
      return {
        setXY(x, y) {
          voices.forEach(v => { v.portamento = 0.1 + x * 2.8; });
          lp.frequency.rampTo(400 + y * 4200, 0.2);
        },
        macro: { label: "bindungskraft", default: 0.5,
          set(v) { voices.forEach(vc => vc.volume.rampTo(-30 + v * 16, 0.1)); } },
        params: [
          { label: "schwebung", default: 0.2,
            set(v) { voices.forEach((vc, i) => { vc.detune.rampTo((i - 1) * v * 22, 0.2); }); } },
          { label: "funken", default: 0.4, set(v) { blip.volume.rampTo(-30 + v * 18, 0.1); } },
        ],
        chordal,
        dispose() {
          voices.forEach(v => { try { v.triggerRelease(); } catch (e) {} });
          setTimeout(() => voices.forEach(v => v.dispose()), 300);
          [blip, lp].forEach(n => n.dispose());
        },
      };
    } },

  { id: "aromen", name: "Aromen", desc: "weiche motive wie geschmacksnoten",
    xyLabels: ["reife", "süße"], xyDefault: [0.5, 0.5], melodyDefault: 0.55,
    build(bus) {
      const mallet = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.02, decay: 0.7, sustain: 0.05, release: 1.2 }, volume: -10,
      });
      mallet.maxPolyphony = 4;
      const vib = new Tone.Vibrato(0.9, 0.05);
      const lp = new Tone.Filter(1800, "lowpass");
      mallet.chain(vib, lp, bus);
      const motif = { synth: mallet, interval: "4n", baseOct: 2, octaves: 2,
                      vel: 0.5, phraseLen: 4, variation: 0.3, restBase: 4 };
      return {
        setXY(x, y) {
          lp.frequency.rampTo(500 + x * 4500, 0.2);
          vib.depth.rampTo(y * 0.35, 0.1);
        },
        macro: { label: "abgang", default: 0.35,
          set(v) { mallet.set({ envelope: { release: 0.4 + v * 4 } }); } },
        params: [
          { label: "herb", default: 0.2, set(v) { mallet.set({ detune: -v * 30 }); } },
          { label: "körper", default: 0.5, set(v) { mallet.volume.rampTo(-20 + v * 14, 0.1); } },
        ],
        motif,
        dispose() { [mallet, vib, lp].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ MAGNETFELD ═════════════════════════════════════════════════ */
{
  id: "magnet", name: "Magnetfeld", color: "#ff7a66",
  desc: "feldlinien · polarität · induktion",
  variants: [

  { id: "feld", name: "Feldlinien", desc: "schwebungen · resonante sweeps",
    xyLabels: ["schwebung", "feldhöhe"], xyDefault: [0.3, 0.35], melodyDefault: null,
    build(bus) {
      let base = 90;
      const o1 = new Tone.Oscillator(base, "sawtooth").start(); o1.volume.value = -18;
      const o2 = new Tone.Oscillator(base + 1.2, "sawtooth").start(); o2.volume.value = -18;
      const filt = new Tone.Filter(260, "lowpass"); filt.Q.value = 7;
      const sweep = new Tone.LFO(0.05, 120, 900).start();
      sweep.connect(filt.frequency);
      o1.connect(filt); o2.connect(filt); filt.connect(bus);
      let beatHz = 1.2;
      const apply = () => { o1.frequency.rampTo(base, 0.4); o2.frequency.rampTo(base + beatHz, 0.4); };
      return {
        setXY(x, y) { beatHz = 0.1 + x * 8; base = 45 + y * 130; apply(); },
        macro: { label: "sweep", default: 0.25, set(v) { sweep.frequency.rampTo(0.01 + v * 0.5, 0.2); } },
        params: [
          { label: "feldschärfe", default: 0.45, set(v) { filt.Q.rampTo(1 + v * 13, 0.1); } },
          { label: "obertöne", default: 0.5,
            set(v) { const t = v < 0.5 ? "sawtooth" : "square"; o1.type = t; o2.type = t; } },
          // 0 = Sweep ruht (Filter steht), 1 = volle Wanderung
          { label: "sweep-tiefe", default: 1, set(v) { sweep.amplitude.rampTo(v, 0.2); } },
        ],
        dispose() { [o1, o2, filt, sweep].forEach(n => n.dispose()); },
      };
    } },

  { id: "polar", name: "Polarität", desc: "zwei pole ziehen sich an und stoßen ab",
    xyLabels: ["anziehung", "feldhöhe"], xyDefault: [0.3, 0.4], melodyDefault: null,
    build(bus) {
      let base = 80;
      const o1 = new Tone.Oscillator(base, "triangle").start(); o1.volume.value = -12;
      const o2 = new Tone.Oscillator(base, "triangle").start(); o2.volume.value = -12;
      const pull = new Tone.LFO(0.08, base, base * 1.5).start(); // Unison ↔ Quinte
      pull.connect(o2.frequency);
      const filt = new Tone.Filter(700, "lowpass");
      const dist = new Tone.Distortion(0.1); dist.wet.value = 0.15;
      o1.connect(filt); o2.connect(filt); filt.chain(dist, bus);
      const apply = () => { o1.frequency.rampTo(base, 0.4); pull.min = base; pull.max = base * 1.5; };
      return {
        setXY(x, y) {
          pull.frequency.rampTo(0.02 + x * 0.55, 0.2);        // wie schnell die Pole ringen
          base = 50 + y * 130; apply();
        },
        macro: { label: "umpolung", default: 0,
          set(v) { pull.type = v < 0.5 ? "sine" : "square"; } }, // square = schnappt!
        params: [
          { label: "glut", default: 0.15, set(v) { dist.wet.rampTo(v * 0.7, 0.1); } },
          { label: "reichweite", default: 0.5, set(v) { pull.max = base * (1.2 + v * 0.8); } },
        ],
        dispose() { [o1, o2, pull, filt, dist].forEach(n => n.dispose()); },
      };
    } },

  { id: "induktion", name: "Induktion", desc: "flackerndes brummen · trafo-flirren",
    xyLabels: ["flackern", "feldhöhe"], xyDefault: [0.35, 0.4], melodyDefault: null,
    build(bus) {
      let base = 85;
      const o = new Tone.Oscillator(base, "square").start(); o.volume.value = -16;
      const hum = new Tone.Oscillator(100, "sine").start(); hum.volume.value = -60;
      const trem = new Tone.Tremolo({ frequency: 11, depth: 0.85 }).start();
      const lp = new Tone.Filter(500, "lowpass");
      o.connect(trem); hum.connect(trem); trem.chain(lp, bus);
      return {
        setXY(x, y) {
          trem.frequency.rampTo(3 + x * 45, 0.2);
          base = 55 + y * 150; o.frequency.rampTo(base, 0.4);
        },
        macro: { label: "netzbrumm", default: 0.1, set(v) { hum.volume.rampTo(-60 + v * 44, 0.1); } },
        params: [
          { label: "raster", default: 0, set(v) { trem.type = v < 0.5 ? "sine" : "square"; } },
          { label: "dämpfung", default: 0.4, set(v) { lp.frequency.rampTo(200 + v * 1800, 0.2); } },
        ],
        dispose() { [o, hum, trem, lp].forEach(n => n.dispose()); },
      };
    } },

  { id: "kompass", name: "Kompasslied", desc: "summende leitstimme über dem feld",
    xyLabels: ["ziehen", "lage"], xyDefault: [0.4, 0.45], melodyDefault: 0.6,
    build(bus) {
      const lead = new Tone.MonoSynth({
        oscillator: { type: "square" },
        envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.6 },
        filter: { Q: 2, type: "lowpass" },
        filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.4,
                          baseFrequency: 200, octaves: 2 },
        portamento: 0.15, volume: -14,
      });
      const dist = new Tone.Distortion(0.2); dist.wet.value = 0.12;
      lead.chain(dist, bus);
      const motif = { synth: lead, interval: "8n", baseOct: 2, octaves: 2,
                      vel: 0.6, phraseLen: 5, variation: 0.3, restBase: 3 };
      return {
        setXY(x, y) {
          lead.portamento = x * 0.5;                     // die Nadel zieht nach
          motif.baseOct = 1 + Math.round(y * 2);
        },
        macro: { label: "glut", default: 0.12, set(v) { dist.wet.rampTo(v * 0.6, 0.1); } },
        params: [
          { label: "nadel", default: 0.3, set(v) { lead.filter.Q.rampTo(0.5 + v * 9, 0.1); } },
          { label: "öffnung", default: 0.4, set(v) { lead.filterEnvelope.baseFrequency = 100 + v * 700; } },
        ],
        motif,
        dispose() { [lead, dist].forEach(n => n.dispose()); },
      };
    } },
  ],
},

/* ══ RHYTHMUS ═══════════════════════════════════════════════════ */
{
  id: "rhythmus", name: "Rhythmus", color: "#ff5d73",
  desc: "kick · sub · bassschleife",
  variants: [

  { id: "kick", name: "Kick", desc: "euklidischer puls · gleichmäßig verteilt",
    xyLabels: ["dichte", "punch"], xyDefault: [0.3, 0.6], melodyDefault: null,
    build(bus) {
      const kick = new Tone.MembraneSynth({
        pitchDecay: 0.05, octaves: 6, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1 },
        volume: -4,
      });
      kick.connect(bus);
      // Euklidischer Rhythmus: k Schläge so gleichmäßig wie möglich auf
      // n Schritte verteilt (Bjorklund) — von Cumbia bis Techno alles drin.
      const euclid = (k, n) => {
        const p = []; let b = 0;
        for (let i = 0; i < n; i++) { b += k; if (b >= n) { b -= n; p.push(1); } else p.push(0); }
        return p;
      };
      const st = { steps: 16, hits: 5, vel: 0.9, tone: 50, pos: 0 };
      st.pattern = euclid(st.hits, st.steps);
      const loop = new Tone.Loop((t) => {
        try {
          const i = st.pos % st.steps; st.pos++;
          if (!st.pattern[i]) return;
          const accent = i === 0 ? 1 : 0.72;
          kick.triggerAttackRelease(st.tone, "8n", t, st.vel * accent);
        } catch (e) {}
      }, "16n").start(0);
      return {
        setXY(x, y) {
          const hits = 1 + Math.round(x * 11);
          if (hits !== st.hits) { st.hits = hits; st.pattern = euclid(hits, st.steps); }
          st.vel = 0.35 + y * 0.65;
        },
        macro: { label: "ton", default: 0.35, set(v) { st.tone = 32 + v * 60; } },
        params: [
          { label: "nachklang", default: 0.35, set(v) { kick.envelope.decay = 0.08 + v * 0.9; } },
          { label: "raster", default: 0.6,
            set(v) { loop.interval = ["4n", "8n", "16n"][Math.floor(v * 2.999)]; } },
        ],
        dispose() { loop.dispose(); kick.dispose(); },
      };
    } },

  { id: "sub", name: "Sub", desc: "tiefes fundament · folgt dem grundton",
    xyLabels: ["gleiten", "oktave"], xyDefault: [0.4, 0.2], melodyDefault: null,
    build(bus, engine) {
      const osc = new Tone.Oscillator(55, "sine").start(); osc.volume.value = -8;
      const osc2 = new Tone.Oscillator(110, "sine").start(); osc2.volume.value = -22;
      const drive = new Tone.Distortion(0.15); drive.wet.value = 0.15;
      const g = new Tone.Gain(0.8);
      osc.connect(drive); osc2.connect(drive); drive.connect(g); g.connect(bus);
      // Puls-Schwellen NUR wenn gewollt: amplitude 0 = konstanter Sub
      const swell = new Tone.LFO(0.07, 0.3, 0.85).start();
      swell.amplitude.value = 0;
      swell.connect(g.gain);
      const st = { glide: 1, oct: -2 };
      // Dem Welt-Grundton nachgleiten (auch wenn er sich ändert)
      const follow = new Tone.Loop(() => {
        try {
          const midi = engine.world.rootMidi + st.oct * 12;
          const f = Tone.Frequency(midi, "midi").toFrequency();
          osc.frequency.rampTo(f, st.glide);
          osc2.frequency.rampTo(f * 2, st.glide);
        } catch (e) {}
      }, 1).start(0);
      return {
        setXY(x, y) { st.glide = 0.1 + x * 3; st.oct = y < 0.5 ? -2 : -1; },
        macro: { label: "puls", default: 0,
          set(v) { swell.amplitude.rampTo(v, 0.3); } },
        params: [
          { label: "wärme", default: 0.3,
            set(v) { drive.distortion = v * 0.7; drive.wet.rampTo(0.05 + v * 0.5, 0.1); } },
          { label: "oberton", default: 0.35, set(v) { osc2.volume.rampTo(-40 + v * 30, 0.1); } },
          { label: "puls-tempo", default: 0.3,
            set(v) { swell.frequency.rampTo(0.02 + v * 0.45, 0.2); } },
        ],
        dispose() { [osc, osc2, drive, g, swell, follow].forEach(n => n.dispose()); },
      };
    } },

  { id: "bassschleife", name: "Bassschleife", desc: "⟳ gelockter basslauf, der sich wandelt",
    xyLabels: ["biss", "lage"], xyDefault: [0.4, 0.25], melodyDefault: 0.8,
    build(bus) {
      const bass = new Tone.MonoSynth({
        oscillator: { type: "square" },
        filter: { Q: 3, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.3 },
        filterEnvelope: { attack: 0.005, decay: 0.14, sustain: 0.3, release: 0.4,
                          baseFrequency: 110, octaves: 2.5 },
        volume: -9,
      });
      bass.connect(bus);
      const turing = { synth: bass, interval: "8n", dur: 0.22,
                       baseOct: 0, octaves: 2, vel: 0.8, len: 8, mutate: 0.1 };
      return {
        setXY(x, y) {
          bass.filterEnvelope.octaves = 1 + x * 4;
          bass.filter.Q.rampTo(0.5 + x * 9, 0.1);
          turing.baseOct = Math.round(y * 2);
        },
        macro: { label: "zupf", default: 0.4,
          set(v) { bass.filterEnvelope.decay = 0.04 + v * 0.5; } },
        params: [
          { label: "länge", default: 0.35, set(v) { turing.dur = 0.08 + v * 0.7; } },
          { label: "holz", default: 0.5,
            set(v) { bass.oscillator.type = v < 0.5 ? "square" : "sawtooth"; } },
        ],
        turing,
        dispose() { bass.dispose(); },
      };
    } },
  ],
},

/* ══ 180°-SICHT ═════════════════════════════════════════════════ */
{
  id: "sicht", name: "180°-Sicht", color: "#e8da7f",
  desc: "panorama · peripherie · rundblick (kopfhörer!)",
  variants: [

  { id: "panorama", name: "Panorama", desc: "kreisende weite · schlingernde bahn",
    xyLabels: ["kreis-tempo", "breite"], xyDefault: [0.35, 0.7], melodyDefault: 0.45,
    build(bus) {
      const voice = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 1.2, decay: 1, sustain: 0.6, release: 5 }, volume: -12,
      });
      voice.maxPolyphony = 4;
      const vib = new Tone.Vibrato(4.5, 0.06);
      const panL = new Tone.Panner(-0.7), panR = new Tone.Panner(0.7);
      const lfoL = new Tone.LFO(0.06, -1, 0.3).start();
      const lfoR = new Tone.LFO(0.055, -0.3, 1).start();
      lfoL.connect(panL.pan); lfoR.connect(panR.pan);
      voice.connect(vib); vib.connect(panL); vib.connect(panR);
      panL.connect(bus); panR.connect(bus);
      return {
        setXY(x, y) {
          lfoL.frequency.rampTo(0.02 + x * 1.1, 0.2);
          lfoR.frequency.rampTo(0.025 + x * 1.25, 0.2);
          const w = 0.15 + y * 0.85;
          lfoL.min = -w; lfoL.max = w * 0.4; lfoR.min = -w * 0.4; lfoR.max = w;
        },
        macro: { label: "flimmern", default: 0.15, set(v) { vib.depth.rampTo(v * 0.5, 0.1); } },
        params: [
          { label: "schlingern", default: 0.3,
            set(v) { lfoR.frequency.rampTo(lfoL.frequency.value * (1 + v * 0.6), 0.2); } },
          { label: "wärme", default: 0.5,
            set(v) { voice.set({ oscillator: { type: v < 0.5 ? "sine" : "triangle" } }); } },
        ],
        melodic: { synth: voice, interval: "2n", dur: "1n", baseOct: 3, octaves: 2, vel: 0.4 },
        dispose() { [voice, vib, panL, panR, lfoL, lfoR].forEach(n => n.dispose()); },
      };
    } },

  { id: "peripherie", name: "Peripherie", desc: "ruf und antwort an den rändern",
    xyLabels: ["abstand", "helligkeit"], xyDefault: [0.7, 0.5], melodyDefault: 0.5,
    build(bus) {
      const mk = () => new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.3, decay: 0.8, sustain: 0.4, release: 3 }, volume: -12,
      });
      const synL = mk(), synR = mk();
      synL.maxPolyphony = 3; synR.maxPolyphony = 3;
      const lp = new Tone.Filter(2500, "lowpass");
      const panL = new Tone.Panner(-0.9), panR = new Tone.Panner(0.9);
      synL.connect(panL); synR.connect(panR);
      panL.connect(lp); panR.connect(lp); lp.connect(bus);
      let side = 1, answerRatio = 1, lag = 0.12;
      // Fassade: die Wanderstimme trifft abwechselnd links und rechts —
      // die rechte Seite antwortet (optional versetzt & transponiert).
      const facade = { triggerAttackRelease(f, d, t, v) {
        side *= -1;
        if (side < 0) synL.triggerAttackRelease(f, d, t, v);
        else synR.triggerAttackRelease(f * answerRatio, d, t + lag, v * 0.85);
      } };
      return {
        setXY(x, y) {
          const w = 0.3 + x * 0.7;
          panL.pan.rampTo(-w, 0.1); panR.pan.rampTo(w, 0.1);
          lp.frequency.rampTo(600 + y * 5000, 0.2);
        },
        macro: { label: "antwort-intervall", default: 0,
          set(v) { answerRatio = [1, 1.5, 2][Math.floor(v * 2.999)]; } }, // prim/quinte/oktave
        params: [
          { label: "versatz", default: 0.15, set(v) { lag = v * 0.6; } },
          { label: "gegenlicht", default: 0.5, set(v) { synR.volume.rampTo(-24 + v * 16, 0.1); } },
        ],
        melodic: { synth: facade, interval: "4n", dur: "2n", baseOct: 3, octaves: 2, vel: 0.5 },
        dispose() { [synL, synR, panL, panR, lp].forEach(n => n.dispose()); },
      };
    } },

  { id: "rundblick", name: "Rundblick", desc: "eine stimme umkreist den kopf",
    xyLabels: ["umlaufzeit", "nähe"], xyDefault: [0.3, 0.6], melodyDefault: 0.4,
    build(bus) {
      const voice = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine2" },
        envelope: { attack: 0.8, decay: 1, sustain: 0.6, release: 4 }, volume: -12,
      });
      voice.maxPolyphony = 3;
      const pan = new Tone.Panner(0);
      const lp = new Tone.Filter(3000, "lowpass");
      const orbit = new Tone.LFO(0.08, -1, 1).start();       // die Bahn …
      orbit.connect(pan.pan);
      const shade = new Tone.LFO(0.08, 700, 4000).start();   // … und ihr Schatten:
      shade.connect(lp.frequency);                            // hinterm Kopf wird's dumpf
      voice.chain(lp, pan, bus);
      let shadeMin = 700;
      return {
        setXY(x, y) {
          const f = 0.02 + x * 0.55;
          orbit.frequency.rampTo(f, 0.2); shade.frequency.rampTo(f, 0.2);
          shade.max = 1200 + y * 6000;                        // Nähe: wie hell "vorn" ist
        },
        macro: { label: "schattentiefe", default: 0.3,
          set(v) { shadeMin = 200 + (1 - v) * 1800; shade.min = shadeMin; } },
        params: [
          { label: "gegenläufer", default: 0.4, set(v) { orbit.min = -1 + v * 0.0; orbit.amplitude.rampTo(0.4 + v * 0.6, 0.2); } },
          { label: "körper", default: 0.5,
            set(v) { voice.set({ oscillator: { type: "sine" + (1 + Math.round(v * 3)) } }); } },
        ],
        melodic: { synth: voice, interval: "2n", dur: "1n", baseOct: 3, octaves: 2, vel: 0.45 },
        dispose() { [voice, pan, lp, orbit, shade].forEach(n => n.dispose()); },
      };
    } },

  { id: "chorkreis", name: "Chorkreis", desc: "jeder akkordton kreist an eigener stelle",
    xyLabels: ["umlauf-tempo", "breite"], xyDefault: [0.35, 0.65], melodyDefault: 0.35,
    build(bus) {
      const vs = [0, 1, 2].map(i => {
        const s = new Tone.Synth({
          oscillator: { type: "triangle" },
          envelope: { attack: 1.2, decay: 1, sustain: 0.6, release: 5 }, volume: -14,
        });
        const p = new Tone.Panner(0);
        const l = new Tone.LFO(0.05 + i * 0.018, -0.8, 0.8).start();
        l.connect(p.pan); s.connect(p); p.connect(bus);
        return { s, p, l };
      });
      let k = 0;
      const facade = { triggerAttackRelease(f, d, t, v) {   // Arp wandert durch die Kreise
        vs[(k++) % 3].s.triggerAttackRelease(f, d, t, v);
      } };
      const chordal = {
        synth: facade, interval: "4n", dur: "2n", baseOct: 3, octaves: 1, vel: 0.4,
        pattern: "auf", wechsel: 6, defaultChords: ["i", "VI", "III"],
        onChord(tones, time) {                     // jeder Ton bezieht seinen Kreis
          tones.slice(0, 3).forEach((mm, i) => {
            try { vs[i].s.triggerAttackRelease(
              Tone.Frequency(mm, "midi").toFrequency(), 4, time + i * 0.2, 0.45); } catch (e) {}
          });
        },
      };
      return {
        setXY(x, y) {
          vs.forEach((v, i) => v.l.frequency.rampTo((0.02 + x * 0.6) * (1 + i * 0.15), 0.2));
          const w = 0.2 + y * 0.8;
          vs.forEach(v => { v.l.min = -w; v.l.max = w; });
        },
        macro: { label: "nachleuchten", default: 0.5,
          set(v) { vs.forEach(vc => vc.s.envelope.release = 1 + v * 9); } },
        params: [
          { label: "wärme", default: 0.5,
            set(v) { vs.forEach(vc => { vc.s.oscillator.type = v < 0.5 ? "sine" : "triangle"; }); } },
          { label: "versatz", default: 0.3,
            set(v) { vs.forEach((vc, i) => vc.l.frequency.rampTo(vc.l.frequency.value * (1 + i * v * 0.4), 0.3)); } },
        ],
        chordal,
        dispose() { vs.forEach(v => { v.s.dispose(); v.p.dispose(); v.l.dispose(); }); },
      };
    } },

  { id: "blickpfad", name: "Blickpfad", desc: "das motiv wandert durchs blickfeld — hohe töne rechts",
    xyLabels: ["blickweite", "höhe"], xyDefault: [0.7, 0.5], melodyDefault: 0.6,
    build(bus) {
      const vs = [0, 1, 2].map(() => {
        const s = new Tone.Synth({
          oscillator: { type: "triangle" },
          envelope: { attack: 0.05, decay: 0.5, sustain: 0.3, release: 1.6 }, volume: -12,
        });
        const p = new Tone.Panner(0); s.connect(p); p.connect(bus);
        return { s, p };
      });
      let k = 0, width = 0.8;
      const lo = 80, hi = 2000;
      const facade = { triggerAttackRelease(f, d, t, v) {  // Tonhöhe → Ort im Blickfeld
        const u = Math.max(0, Math.min(1, Math.log(f / lo) / Math.log(hi / lo)));
        const voice = vs[(k++) % 3];
        voice.p.pan.setValueAtTime((u * 2 - 1) * width, t);
        voice.s.triggerAttackRelease(f, d, t, v);
      } };
      const motif = { synth: facade, interval: "8n", baseOct: 3, octaves: 2,
                      vel: 0.5, phraseLen: 5, variation: 0.4, restBase: 3 };
      return {
        setXY(x, y) {
          width = 0.2 + x * 0.8;
          motif.baseOct = 2 + Math.round(y * 2);
        },
        macro: { label: "nachleuchten", default: 0.4,
          set(v) { vs.forEach(vc => vc.s.envelope.release = 0.4 + v * 4); } },
        params: [
          { label: "wärme", default: 0.5,
            set(v) { vs.forEach(vc => { vc.s.oscillator.type = v < 0.5 ? "sine" : "triangle"; }); } },
          { label: "fokus", default: 0.5,
            set(v) { vs.forEach(vc => vc.s.volume.rampTo(-18 + v * 10, 0.1)); } },
        ],
        motif,
        dispose() { vs.forEach(v => { v.s.dispose(); v.p.dispose(); }); },
      };
    } },
  ],
},

];

export const senseById = (id) => SENSES.find(s => s.id === id);
