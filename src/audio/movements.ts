/**
 * The eight authored **movements** — the score of the piece, one MP3 per section — driven from the
 * Theatre timeline (docs §4 + §6).
 *
 * Theatre.js (0.7.2) has no native way to lay an audio clip on the sequence editor as a
 * length-bar: its only audio feature, `sequence.attachAudio()`, is a single global soundtrack with
 * no visual representation (the Studio bundle ships no waveform UI). So each movement is exposed
 * instead as a **keyable 0..1 number envelope** on the `arc` object (see {@link MOVEMENTS} →
 * `arc.tracks.<id>` in `../theatre/project.ts`). Theatre draws the line *between* keyframes, so a
 * fade-in → plateau → fade-out envelope reads as a visible bar on the timeline whose width is the
 * clip's length — and the same curve *is* the clip's live volume automation.
 *
 * {@link createMovementScore} is the consumer: each frame it reads the authored envelopes and
 * turns edges into transport on the {@link SoundBus} —
 *   • envelope rises off 0  → `play` the clip from its start,
 *   • envelope > 0          → `setGain` follows the curve (live volume),
 *   • envelope returns to 0  → `stop` with a short fade.
 *
 * Playback is realtime-triggered (a Web Audio buffer, once started, ignores clock pause/timeScale —
 * the same limitation as the one-shot cues). In a normal forward-playing run that's inaudible; it
 * only shows if you pause or scrub mid-movement while authoring in Studio.
 */
import type { SoundBus } from "./index.ts";

export interface Movement {
  /** Envelope key on `arc.tracks` and the SoundBus id. */
  id: string;
  /** Human label (Studio prop name + dev reference). */
  label: string;
  /** Public URL of the MP3 (served from `public/audio/movements/`). */
  src: string;
  /** Clip length in seconds — the width of the default envelope bar in `state.json`. */
  duration: number;
  /** Peak playback gain the 0..1 envelope scales (0..1). */
  gain: number;
}

/**
 * The score, in program order. `duration` values are the decoded MP3 lengths (via ffprobe) — they
 * set the width of each committed envelope bar in `src/theatre/state.json`; the default start
 * positions there align each movement to its matching sense's rising edge in the dramaturgy.
 */
export const MOVEMENTS: readonly Movement[] = [
  {
    id: "intro",
    label: "① Intro",
    src: "/audio/movements/bm-1-intro.mp3",
    duration: 71.188,
    gain: 0.85,
  },
  {
    id: "scent",
    label: "② Scent",
    src: "/audio/movements/bm-2-scent.mp3",
    duration: 43.369,
    gain: 0.85,
  },
  {
    id: "depth",
    label: "③ Depth",
    src: "/audio/movements/bm-3-depth.mp3",
    duration: 45.247,
    gain: 0.85,
  },
  {
    id: "motion",
    label: "④ Motion",
    src: "/audio/movements/bm-4-motion.mp3",
    duration: 48.319,
    gain: 0.85,
  },
  {
    id: "infrared",
    label: "⑤ Infrared",
    src: "/audio/movements/bm-5-infrared.mp3",
    duration: 62.484,
    gain: 0.85,
  },
  {
    id: "magnetic",
    label: "⑥ Magnetic Field",
    src: "/audio/movements/bm-6-magnetic-field.mp3",
    duration: 44.82,
    gain: 0.85,
  },
  {
    id: "overload",
    label: "⑦ Overload",
    src: "/audio/movements/bm-7-overload.mp3",
    duration: 74.601,
    gain: 0.85,
  },
  {
    id: "finale",
    label: "⑧ Finale",
    src: "/audio/movements/bm-8-finale.mp3",
    duration: 72.127,
    gain: 0.85,
  },
] as const;

/** Fade-out applied when an envelope snaps to 0 without ramping down (safety against clicks). */
const STOP_FADE = 0.25;

export interface MovementScore {
  /** Read the authored envelopes and drive playback. Call once per frame, after `pumpAuthored`. */
  update(): void;
  dispose(): void;
}

/**
 * Wire the authored movement envelopes to the sound bus. `readEnvelopes` returns the current
 * `arc.tracks` value ({@link MOVEMENTS} id → 0..1); the score defines each clip on the bus and, per
 * frame, converts envelope edges into play / gain / stop.
 */
export function createMovementScore(
  bus: SoundBus,
  readEnvelopes: () => Record<string, number>,
): MovementScore {
  for (const m of MOVEMENTS) {
    // gain 0 + deferPlay: the clip starts silent (the envelope raises it the same frame) and honours
    // its authored start even if the buffer is still decoding — so no movement misses its cue.
    bus.define({ id: m.id, src: m.src, gain: 0, deferPlay: true, fadeOut: STOP_FADE });
  }

  const prev = new Map<string, number>(MOVEMENTS.map((m) => [m.id, 0]));

  return {
    update(): void {
      const env = readEnvelopes();
      for (const m of MOVEMENTS) {
        const v = env[m.id] ?? 0;
        const was = prev.get(m.id) ?? 0;
        if (was <= 0 && v > 0) {
          bus.play(m.id);
        }
        if (v > 0) {
          bus.setGain(m.id, v * m.gain);
        } else if (was > 0) {
          bus.stop(m.id, STOP_FADE);
        }
        prev.set(m.id, v);
      }
    },
    dispose(): void {
      for (const m of MOVEMENTS) {
        bus.stop(m.id, 0);
      }
    },
  };
}
