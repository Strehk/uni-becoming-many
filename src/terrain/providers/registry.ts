// ── Becoming Many — Terrain Provider Registry ──────────────────
//
// A plain runtime map of terrain algorithms. Register at import time (see
// ./index.ts) or at runtime; TerrainWorld can switch between any registered
// provider live.

import type { TerrainProvider } from "../provider.ts";

const REGISTRY = new Map<string, TerrainProvider>();

/** Register (or replace) a provider by its id. */
export function registerTerrainProvider(provider: TerrainProvider): void {
  REGISTRY.set(provider.id, provider);
}

/** Look up a provider, throwing if the id is unknown (fail fast on a typo'd id). */
export function getTerrainProvider(id: string): TerrainProvider {
  const provider = REGISTRY.get(id);
  if (!provider) {
    const known = [...REGISTRY.keys()].join(", ") || "(none)";
    throw new Error(`Unknown terrain provider "${id}". Registered: ${known}`);
  }
  return provider;
}

/** All registered providers, in insertion order (for building the Settings enum). */
export function listTerrainProviders(): TerrainProvider[] {
  return [...REGISTRY.values()];
}
