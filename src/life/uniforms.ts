// ── Becoming Many — Life Uniforms ──────────────────────────────
//
// Live TSL uniforms shared by every flora material. Where `KitUniforms` (src/render/)
// says how the WORLD looks under the current sense, these say how ALIVE it is —
// driven from the signal substrate each frame by `src/life/index.ts`, which is their
// sole writer.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`.

import { uniform } from "three/tsl";

/** Build the live life uniforms. */
export function createLifeUniforms() {
  return {
    /**
     * Virtual elapsed seconds, mirroring `signals.time`. WRITER: life.update.
     *
     * Deliberately NOT TSL's `time`, which counts real renderer frames: the wind must
     * obey the transport (pause/seek/timeScale), and the `instanceAwaken` stamps —
     * taken from `signals.time` — must share a timebase with the wave that reads them.
     */
    clock: uniform(0),
    /** Global sway amplitude multiplier. WRITER: life.update, from `signals.unrest`. */
    swayStrength: uniform(1),
    /** How much the flora glows of its own accord, 0..1. WRITER: life.update, eased
     *  toward the active sense's target (`duft` blooms; `luft` goes dark). */
    bioluminescence: uniform(0),
    /** Emissive gain. WRITER: life.update, from authored `signals.intensity`. */
    emissiveGain: uniform(0),
  };
}

export type LifeUniforms = ReturnType<typeof createLifeUniforms>;

/** How strongly each sense makes living things glow. Keys mirror `SenseId`. */
// Keyed by the nine layerable SenseId's (see src/senses/ids.ts); "none" (the white
// void) and any unmapped sense fall through to 0 at the call site. How brightly the
// flora self-illuminates under each perception.
export const BIOLUMINESCENCE_BY_SENSE: Readonly<Record<string, number>> = {
  farben: 0.15, // the visible daylight image — a faint sheen
  echo: 0.2, // sonar picks out surfaces, not warmth
  infrarot: 0.5, // living things run warm
  uv: 0.8, // UV reveals organic signals — nectar guides, lichen glow
  duft: 1.0, // chemosense: the world is signalling
  netzwerk: 0.7, // the collective lights up
  motion: 0, // only movement is visible — static flora stays dark
  magnetfeld: 0, // a sky sense — the ground reads neutral
  rundum: 0.15, // projection change only — keep the faint daylight sheen
};
