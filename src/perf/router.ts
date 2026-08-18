// ── Becoming Many — Performance routing ──────────────────────────
//
// The one place that knows how a quality knob id reaches the live world. Three
// kinds of destination hide behind a single `route(id).set(v)`:
//
//   • perf-owned  ("renderScale", "grassRadius", "streamBuildRadius", …) — write
//     the PerfState and apply directly (uniform / scheduler writes, no rebuild).
//   • flora/fauna ("flora.treeDensity", "fauna.deerCount", …) — emit
//     `flora-fauna:param`; the coordinator debounces and re-scatters.
//   • sense budgets ("duft.count", "motion.lifetimeFrames", …) — emit
//     `sense:param` on the modules' own live channel.
//
// Two UIs drive these: the C-console Performance panel (every slider) and the
// audience Einstellungen screen (presets only). Both share one router instance, so
// a preset chosen in the menu moves the console's sliders too — `onPresetApplied`
// is the notification that lets a panel re-sync without polling.

import type { FloraFaunaConfig } from "../flora-fauna/config.ts";
import type { Bus } from "../signals/index.ts";
import type { Preset } from "./presets.ts";
import type { PerfState } from "./state.ts";

/** One routed knob: read its live value, or push a new one into the world. */
export interface PerfKnob {
  get(): number;
  set(value: number): void;
}

/** Committed sense-module start values (from src/senses/state.json + module defaults). */
export interface SenseStartValues {
  duftCount: number;
  duftCheapNoise: boolean;
  motionLifetimeFrames: number;
}

export interface PerfRouterOptions {
  bus: Bus;
  /** The live perf state (mutated in place; serialized by the dev save button). */
  perf: PerfState;
  /** Direct apply hooks for the perf-owned knobs. */
  apply: {
    renderScale(v: number): void;
    grassRadius(v: number): void;
    grassKeepFraction(v: number): void;
    streamBuildRadius(v: number): void;
    floraViewDistance(v: number): void;
  };
  /** The live flora/fauna config — start values for the bus-driven knobs. */
  floraFauna: FloraFaunaConfig;
  senseStart: SenseStartValues;
}

export interface PerfRouter {
  /** Resolve a knob id to its live value + apply action. */
  route(id: string): PerfKnob;
  /** The duft cheap-turbulence toggle (a preset field, not a numeric knob). */
  setCheapNoise(on: boolean): void;
  /** Push every value of a preset into the world and record it as the active one. */
  applyPreset(preset: Preset): void;
  /** Record that the tuning no longer matches any preset (a slider was moved). */
  markCustom(): void;
  /** Id of the active preset, or "eigene" once a knob has been moved by hand. */
  readonly activePreset: string;
  /** Notified after every `applyPreset` — panels use it to re-sync their controls. */
  onPresetApplied(cb: (preset: Preset) => void): () => void;
  /** Live mirror of the sense knobs (the modules own the truth; this tracks edits). */
  readonly senseLive: SenseStartValues;
}

/** Marker id for "the knobs no longer match any preset". */
export const CUSTOM_PRESET_ID = "eigene";

export function createPerfRouter(options: PerfRouterOptions): PerfRouter {
  const { bus, perf, apply, floraFauna } = options;

  const senseLive: SenseStartValues = { ...options.senseStart };
  const listeners = new Set<(preset: Preset) => void>();

  /** A knob that lives in the PerfState and applies straight to the world. */
  const perfKnob = (
    read: () => number,
    write: (v: number) => void,
    push: (v: number) => void,
  ): PerfKnob => ({
    get: read,
    set: (v) => {
      write(v);
      push(v);
    },
  });

  /** A knob owned by a module, reached over its bus channel. */
  const senseKnob = (key: string, read: () => number, write: (v: number) => void): PerfKnob => ({
    get: read,
    set: (v) => {
      write(v);
      const [id, field] = key.split(".");
      bus.emit("sense:param", { id: id ?? "", key: field ?? "", value: v });
    },
  });

  const route = (id: string): PerfKnob => {
    switch (id) {
      case "renderScale":
        return perfKnob(
          () => perf.renderScale,
          (v) => {
            perf.renderScale = v;
          },
          apply.renderScale,
        );
      case "grassRadius":
        return perfKnob(
          () => perf.grassRadius,
          (v) => {
            perf.grassRadius = v;
          },
          apply.grassRadius,
        );
      case "grassKeepFraction":
        return perfKnob(
          () => perf.grassKeepFraction,
          (v) => {
            perf.grassKeepFraction = v;
          },
          apply.grassKeepFraction,
        );
      case "streamBuildRadius":
        return perfKnob(
          () => perf.streamBuildRadius,
          (v) => {
            perf.streamBuildRadius = v;
          },
          apply.streamBuildRadius,
        );
      case "floraViewDistance":
        return perfKnob(
          () => perf.floraViewDistance,
          (v) => {
            perf.floraViewDistance = v;
          },
          apply.floraViewDistance,
        );
      case "duft.count":
        return senseKnob(
          id,
          () => senseLive.duftCount,
          (v) => {
            senseLive.duftCount = v;
          },
        );
      case "motion.lifetimeFrames":
        return senseKnob(
          id,
          () => senseLive.motionLifetimeFrames,
          (v) => {
            senseLive.motionLifetimeFrames = v;
          },
        );
      default: {
        // Dotted flora/fauna keys → the coordinator's bus channel (it debounces the
        // re-scatter/rebuild itself), with start values read off the live config.
        const [domain, field] = id.split(".");
        const record: Record<string, unknown> =
          domain === "flora"
            ? (floraFauna.flora as unknown as Record<string, unknown>)
            : (floraFauna.fauna as unknown as Record<string, unknown>);
        return {
          get: () => {
            const v = field !== undefined ? record[field] : undefined;
            return typeof v === "number" ? v : 0;
          },
          set: (v) => {
            bus.emit("flora-fauna:param", { key: id, value: v });
          },
        };
      }
    }
  };

  const setCheapNoise = (on: boolean): void => {
    senseLive.duftCheapNoise = on;
    bus.emit("sense:param", { id: "duft", key: "cheapNoise", value: on });
  };

  const applyPreset = (preset: Preset): void => {
    for (const [id, value] of Object.entries(preset.values)) {
      route(id).set(value);
    }
    setCheapNoise(preset.cheapNoise);
    perf.preset = preset.id;
    for (const cb of listeners) {
      cb(preset);
    }
  };

  return {
    route,
    setCheapNoise,
    applyPreset,
    markCustom(): void {
      perf.preset = CUSTOM_PRESET_ID;
    },
    get activePreset(): string {
      return perf.preset;
    },
    onPresetApplied(cb): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    senseLive,
  };
}
