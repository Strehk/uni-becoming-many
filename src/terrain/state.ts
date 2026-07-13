// ── Becoming Many — Worldgen tuning persistence (Theatre-style state.json) ──
//
// The terrain tuning authored in the C dev console (World panel) is committed to
// `state.json` next to the terrain and loaded on boot — the same pattern as
// `src/theatre/state.json` and `src/synth/vendor/state.json`. We save the active
// provider, the flat TerrainConfig (seed/amplitude/frequency/octaves) and the
// GenParams overlay (touched keys only), and restore them through the world's own
// `setProvider` / `setConfig` / `setParams`.
//
// The dev-only export button lives in the dev console (see dev-console/save-tuning.ts);
// this module owns the file, the load, and the serialize.

import type { TerrainConfig, TerrainWorld } from "./index.ts";
import savedTerrainState from "./state.json";

export { savedTerrainState };

export interface TerrainStateFile {
  version: 1;
  provider: string;
  config: TerrainConfig;
  params: Record<string, number>;
}

/** Read the current worldgen tuning into a plain JSON object (for the dev export). */
export function serializeTerrainState(world: TerrainWorld): TerrainStateFile {
  return {
    version: 1,
    provider: world.providerId,
    config: { ...world.config },
    params: { ...world.paramOverrides },
  };
}

/** Apply a committed worldgen tuning on boot. Tolerant: no-ops on the empty placeholder. */
export function loadTerrainState(state: unknown, world: TerrainWorld): void {
  if (typeof state !== "object" || state === null) {
    return;
  }
  const source = state as Partial<TerrainStateFile>;
  if (!source.provider && !source.config) {
    return; // empty placeholder — code defaults win
  }

  // A provider swap rebuilds with the saved config folded in; otherwise just patch config.
  if (source.provider && source.provider !== world.providerId) {
    world.setProvider(source.provider, source.config);
  } else if (source.config) {
    world.setConfig(source.config);
  }

  if (source.params && Object.keys(source.params).length > 0) {
    world.setParams(source.params);
  }
}
