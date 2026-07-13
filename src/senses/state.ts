// ── Becoming Many — Sense look persistence (Theatre-style state.json) ──
//
// The sense tuning authored in the C dev console (Sinne panel) is committed to
// `state.json` next to the content it configures and loaded on boot — the same
// pattern as `src/theatre/state.json` and `src/synth/vendor/state.json`.
//
//   • The four SHADER senses (farben/echo/infrarot/uv) round-trip through the
//     SenseSystem's own `serialize()` / `apply()` (params + blend + layer order +
//     base colour, format "becoming-many-senses"). We reuse it wholesale.
//   • The five STANDALONE senses (magnetfeld/duft/netzwerk/motion/rundum) expose
//     their params as UI descriptors with live `get()` bindings; we snapshot those
//     and replay them on load over the `sense:param` bus — the exact channel the
//     dev UI writes, so every module's existing handler applies them.
//
// The dev-only export button lives in the dev console (see dev-console/save-tuning.ts);
// this module owns the file, the load, and the serialize.

import type { SensePanelDescriptor } from "../dev-console/sense-controls.ts";
import type { Bus } from "../signals/index.ts";
import savedSenseState from "./state.json";
import type { ShaderSenses } from "./shader/index.ts";
import { SETTINGS_FORMAT, type SenseSettings } from "./shader/sense-system.ts";

export { savedSenseState };

/** The committed sense look. `shader` is the native SenseSystem format; `modules`
 *  maps each standalone sense id → its param values. */
export interface SenseStateFile {
  version: 1;
  shader: SenseSettings | null;
  modules: Record<string, Record<string, number | string | boolean>>;
}

/** Snapshot the standalone senses' params from their descriptor `get()` bindings. */
function serializeModules(
  modules: SensePanelDescriptor[],
): Record<string, Record<string, number | string | boolean>> {
  const out: Record<string, Record<string, number | string | boolean>> = {};
  for (const descriptor of modules) {
    const values: Record<string, number | string | boolean> = {};
    for (const control of descriptor.controls) {
      if (control.type === "presets") {
        continue; // presets are command bundles, no readable value
      }
      values[control.key] = control.get();
    }
    out[descriptor.key] = values;
  }
  return out;
}

/** Read the current sense look into a plain JSON object (for the dev export). */
export function serializeSenseState(
  shader: ShaderSenses,
  modules: SensePanelDescriptor[],
): SenseStateFile {
  return {
    version: 1,
    shader: shader.system.serialize("becoming-many"),
    modules: serializeModules(modules),
  };
}

/** Apply a committed sense look on boot. Tolerant: no-ops on the empty placeholder. */
export function loadSenseState(state: unknown, ctx: { shader: ShaderSenses; bus: Bus }): void {
  if (typeof state !== "object" || state === null) {
    return;
  }
  const source = state as Partial<SenseStateFile>;

  // Shader senses: params + blend + order + base, via the system's own loader.
  const shaderState = source.shader;
  if (
    shaderState &&
    typeof shaderState === "object" &&
    (shaderState as { format?: string }).format === SETTINGS_FORMAT
  ) {
    ctx.shader.system.apply(shaderState);
  }

  // Standalone senses: replay each param over the bus (same channel as the UI).
  const modules = source.modules;
  if (modules && typeof modules === "object") {
    for (const [id, params] of Object.entries(modules)) {
      if (!params || typeof params !== "object") {
        continue;
      }
      for (const [key, value] of Object.entries(params)) {
        ctx.bus.emit("sense:param", { id, key, value });
      }
    }
  }
}
