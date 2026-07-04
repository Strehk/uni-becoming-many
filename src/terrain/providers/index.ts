// ── Becoming Many — Terrain Providers ──────────────────────────
//
// Importing this module registers the built-in providers as a side effect, then
// re-exports the registry surface. Anything that needs a provider should import
// from here (or call registerTerrainProvider with its own) so the registry is
// guaranteed populated.
//
// The worldgen "chunk" provider is a thin shell (id/label/kind/defaultConfig) —
// the heavy generation lives in the worldgen worker, so registering it here does
// NOT bloat the main bundle.

import { registerTerrainProvider } from "./registry.ts";
import { ridgedProvider } from "./ridged.ts";
import { sineHillsProvider } from "./sine-hills.ts";
import { worldgenProvider } from "./worldgen.ts";

registerTerrainProvider(sineHillsProvider);
registerTerrainProvider(ridgedProvider);
registerTerrainProvider(worldgenProvider);

export {
  getTerrainProvider,
  listTerrainProviders,
  registerTerrainProvider,
} from "./registry.ts";
export { ridgedProvider } from "./ridged.ts";
export { sineHillsProvider } from "./sine-hills.ts";
export { worldgenProvider } from "./worldgen.ts";

/** The provider the world opens with. */
export const DEFAULT_PROVIDER_ID = worldgenProvider.id;
