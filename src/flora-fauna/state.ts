// ── Becoming Many — Flora & Fauna persistence ──────────────────
//
// The density / forest-shape / flock tuning authored in the C dev console
// (Flora & Fauna panel) is committed to `state.json` next to this module and
// loaded on boot — the same pattern as senses/state.json and terrain/state.json.
//
// The whole config is a plain JSON object, so serialize is a snapshot of the
// live controller config, and load replays each leaf value over the
// `flora-fauna:param` bus — the exact channel the dev panel writes, so the
// controller's one handler applies them (density → re-scatter, counts → rebuild).

import type { Bus } from "../signals/index.ts";
import { DEFAULT_CONFIG, type FloraFaunaConfig } from "./config.ts";
import type { FloraFaunaController, FloraFaunaStateFile } from "./index.ts";
import savedFloraFaunaState from "./state.json";

export { savedFloraFaunaState };

/** The committed config, merged over the defaults so a partial/legacy file still
 *  boots. Passed straight into createLife / createCreatures / the controller — the
 *  world streams with these values from the first chunk (no boot re-scatter). */
export function configFromState(state: unknown): FloraFaunaConfig {
  const config =
    typeof state === "object" && state !== null
      ? (state as Partial<FloraFaunaStateFile>).config
      : undefined;
  if (!config || typeof config !== "object") return DEFAULT_CONFIG;
  const rawFauna = config.fauna as
    | (Partial<FloraFaunaConfig["fauna"]> & {
        birdsPerFlock?: number;
        batsPerFlock?: number;
      })
    | undefined;
  const { birdsPerFlock, batsPerFlock, ...currentFauna } = rawFauna ?? {};
  const fauna = { ...DEFAULT_CONFIG.fauna, ...currentFauna };
  if (rawFauna?.birdMinPerFlock === undefined && typeof birdsPerFlock === "number") {
    fauna.birdMinPerFlock = birdsPerFlock;
  }
  if (rawFauna?.birdMaxPerFlock === undefined && typeof birdsPerFlock === "number") {
    fauna.birdMaxPerFlock = birdsPerFlock;
  }
  if (rawFauna?.batMinPerFlock === undefined && typeof batsPerFlock === "number") {
    fauna.batMinPerFlock = batsPerFlock;
  }
  if (rawFauna?.batMaxPerFlock === undefined && typeof batsPerFlock === "number") {
    fauna.batMaxPerFlock = batsPerFlock;
  }

  return {
    flora: { ...DEFAULT_CONFIG.flora, ...config.flora },
    fauna,
  };
}

/** Snapshot the live config for the dev export. */
export function serializeFloraFaunaState(controller: FloraFaunaController): FloraFaunaStateFile {
  return controller.serialize();
}

/** Flatten the nested config into `flora-fauna:param` bus commands and replay
 *  them (same channel as the dev panel). Tolerant of the empty placeholder and of
 *  partial/legacy files — unknown keys are ignored by the controller. */
export function loadFloraFaunaState(state: unknown, ctx: { bus: Bus }): void {
  if (typeof state !== "object" || state === null) return;
  const config = (state as Partial<FloraFaunaStateFile>).config;
  if (!config || typeof config !== "object") return;

  const emit = (prefix: string, obj: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "number") {
        ctx.bus.emit("flora-fauna:param", { key: `${prefix}.${key}`, value });
      } else if (value && typeof value === "object") {
        // Nested (e.g. flora.speciesCap.<id>).
        emit(`${prefix}.${key}`, value as Record<string, unknown>);
      }
    }
  };

  const c = config as unknown as Record<string, unknown>;
  const flora = c["flora"];
  const fauna = c["fauna"];
  if (flora && typeof flora === "object") emit("flora", flora as Record<string, unknown>);
  if (fauna && typeof fauna === "object") emit("fauna", fauna as Record<string, unknown>);
}
