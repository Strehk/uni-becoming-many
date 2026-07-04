/** River network helpers (the graph types live in mapTypes). */
import type { RiverNetwork } from "../../mapTypes.ts";

export function emptyNetwork(): RiverNetwork {
  return { paths: [], sources: [] };
}
