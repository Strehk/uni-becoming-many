// ── Becoming Many — Flora & Fauna coordinator ──────────────────
//
// The umbrella that binds flora (src/life) and fauna (src/creatures) to ONE
// tunable, exportable config. It owns the live `FloraFaunaConfig`, listens for
// `flora-fauna:param {key, value}` bus commands (the dev panel emits these; the
// state loader replays them — same channel, exactly the senses pattern), and
// applies them: debounced, because a flora density change re-scatters every live
// chunk and a fauna count change rebuilds the flock — both too heavy to run on
// every slider tick.
//
// Dotted keys address the nested config: `flora.treeDensity`, `fauna.mushroomCount`,
// or the advanced `flora.speciesCap.<id>`. Serialize snapshots the live config for
// the "⤓ Flora & Fauna" export.

import type { Creatures } from "../creatures/index.ts";
import type { Life } from "../life/index.ts";
import type { SpeciesId } from "../life/species.ts";
import type { Bus } from "../signals/index.ts";
import { DEFAULT_CONFIG, type FloraFaunaConfig } from "./config.ts";

/** Coalesce a slider drag into one apply — a re-scatter / flock rebuild is heavy. */
const FLUSH_MS = 160;

export interface FloraFaunaStateFile {
  readonly version: 1;
  readonly config: FloraFaunaConfig;
}

export interface FloraFaunaController {
  /** The live config (mutated in place by bus commands). */
  readonly config: FloraFaunaConfig;
  /** Snapshot the live config for export. */
  serialize(): FloraFaunaStateFile;
  dispose(): void;
}

/** A deep-mutable mirror of FloraFaunaConfig (the interfaces are readonly). */
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
type MutableConfig = Mutable<FloraFaunaConfig>;

export interface CreateFloraFaunaOptions {
  life: Life;
  creatures: Creatures;
  bus: Bus;
  /** Initial config (from the loaded state, or DEFAULT_CONFIG). */
  config?: FloraFaunaConfig;
}

export function createFloraFaunaController(opts: CreateFloraFaunaOptions): FloraFaunaController {
  const { life, creatures, bus } = opts;

  // Deep, mutable copy so bus edits never alias the caller's config / defaults.
  const cfg: MutableConfig = structuredClone(opts.config ?? DEFAULT_CONFIG) as MutableConfig;

  // ── debounced apply, one timer per subsystem ──
  let floraTimer: ReturnType<typeof setTimeout> | undefined;
  let faunaTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFlora = (): void => {
    clearTimeout(floraTimer);
    floraTimer = setTimeout(() => life.applyConfig(cfg.flora), FLUSH_MS);
  };
  const scheduleFauna = (): void => {
    clearTimeout(faunaTimer);
    faunaTimer = setTimeout(() => creatures.reconfigure(cfg.fauna), FLUSH_MS);
  };

  /** Route one dotted-key param onto the mutable config + its apply schedule. */
  const applyParam = (key: string, value: number): void => {
    if (key.startsWith("flora.speciesCap.")) {
      const id = key.slice("flora.speciesCap.".length) as SpeciesId;
      cfg.flora.speciesCap[id] = value;
      scheduleFlora();
      return;
    }
    const [domain, field] = key.split(".");
    if (domain === "flora" && field && field in cfg.flora) {
      (cfg.flora as Record<string, unknown>)[field] = value;
      scheduleFlora();
    } else if (domain === "fauna" && field && field in cfg.fauna) {
      (cfg.fauna as Record<string, unknown>)[field] = value;
      scheduleFauna();
    }
  };

  const off = bus.on("flora-fauna:param", (payload) => {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as { key?: unknown; value?: unknown };
    if (typeof p.key === "string" && typeof p.value === "number") applyParam(p.key, p.value);
  });

  return {
    config: cfg,
    serialize(): FloraFaunaStateFile {
      return { version: 1, config: structuredClone(cfg) };
    },
    dispose(): void {
      clearTimeout(floraTimer);
      clearTimeout(faunaTimer);
      off();
    },
  };
}

export { DEFAULT_CONFIG } from "./config.ts";
export type { FloraFaunaConfig } from "./config.ts";
