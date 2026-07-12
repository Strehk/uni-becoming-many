// Collects the four built-in shader-sense modules in their default order.
// New sense: create a module after the echolocation.ts pattern, import it here
// and add it to createDefaultSenses() — done.

import type { ShaderSense } from "../sense-types.ts";
import { createEcholocation } from "./echolocation.ts";
import { createFarben } from "./farben.ts";
import { createInfrared } from "./infrared.ts";
import { createUV } from "./uv.ts";

export { createEcholocation } from "./echolocation.ts";
export { createFarben } from "./farben.ts";
export { createInfrared } from "./infrared.ts";
export { createUV } from "./uv.ts";

/** Order = default layering (index 0 applied first = "bottom"). */
export function createDefaultSenses(): ShaderSense[] {
  return [createFarben(), createEcholocation(), createInfrared(), createUV()];
}
