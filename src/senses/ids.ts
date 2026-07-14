/**
 * The canonical sense vocabulary — the nine layerable perceptions of Becoming Many.
 *
 * Every module that reacts to a sense (terrain shader layers, scent particles, the
 * swarm network, the synth bridge, the Theatre envelopes, the dev UI) speaks in these
 * ids. Kept in its own leaf module so the signal registry, the director and the sense
 * modules can all import it without cycles.
 *
 * Senses are LAYERS, not exclusive modes: each has an intensity 0..1 in
 * `signals.sense[id]`, and any combination may be active at once. (`rundum` is the
 * one exception in behaviour — it swaps the camera projection — but it shares the
 * same signal contract.)
 */
export type SenseId =
  | "farben"
  | "echo"
  | "infrarot"
  | "uv"
  | "duft"
  | "netzwerk"
  | "motion"
  | "magnetfeld"
  | "rundum";

/** Canonical module ids. Keep this as the full set of real sense modules so
 *  signals, Theatre, synth cues and optional panels don't lose a cell when the
 *  manual key order changes. */
export const SENSE_ORDER: readonly SenseId[] = [
  "farben",
  "echo",
  "infrarot",
  "uv",
  "duft",
  "netzwerk",
  "motion",
  "magnetfeld",
  "rundum",
];

/** Senses that perceive only the AIR, not the world's surfaces. While solely an
 *  air-only sense is active, terrain/flora/grass stay in the white void — you see
 *  the medium (scent plumes, dust), never the ground it drifts over. Consumed by
 *  the world-reveal gates in main.ts and src/grass/. */
export const AIR_ONLY_SENSES: ReadonlySet<SenseId> = new Set(["duft"]);

export type SenseKeySlot = SenseId | null;

/** Manual performance order. `null` is Luft: all sense layers off, white void.
 *  Ten slots on the digit row: keys 1–9 map to slots 1–9, key 0 to slot 10. */
export const SENSE_KEY_ORDER: readonly SenseKeySlot[] = [
  null,
  "echo",
  "motion",
  "infrarot",
  "uv",
  "farben",
  "duft",
  "magnetfeld",
  "netzwerk",
  "rundum",
];

export const SENSE_LABELS: Record<SenseId, string> = {
  farben: "Wahrnehmbare Farben",
  echo: "Echoortung",
  infrarot: "Infrarot (Wärme)",
  uv: "UV-Reflexion",
  duft: "Chemische Wahrnehmung",
  netzwerk: "Schwarm-Netzwerk",
  motion: "Bewegungssehen",
  magnetfeld: "Magnetfeld",
  rundum: "360°-Rundumblick",
};

export function isSenseId(value: unknown): value is SenseId {
  return typeof value === "string" && (SENSE_ORDER as readonly string[]).includes(value);
}

/**
 * Which Tone-synth sense (SynthModulHandy `senses/registry.js` id) accompanies each
 * visual sense.
 */
export const SENSE_SYNTH_MAP: Partial<Record<SenseId, string>> = {
  farben: "luft",
  echo: "echo",
  infrarot: "infrarot",
  uv: "licht",
  duft: "chemie",
  netzwerk: "rhythmus",
  motion: "motion",
  magnetfeld: "magnet",
  rundum: "sicht",
};
