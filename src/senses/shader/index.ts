// ── Shader senses — public facade + signal coupling ────────────
//
// The port of ShaderSinneModul's `src/core/` (see docs/MASTERPLAN.md §3A). This barrel
// wires the four terrain-composited senses (farben / echo / infrarot / uv) onto the
// signal substrate:
//
//   - `signals.sense[key]` (0..1, written by the SenseDirector / Theatre bridge) is the
//     layer's target; `update(dt)` eases each sense's `enabled` uniform toward it, so
//     layers fade in/out smoothly no matter who switched them.
//   - `uTime` follows `signals.time` (the clock spine) — the echo ping pauses, seeks
//     and re-scales with the whole piece.
//   - `compositor` is the structural interface the terrain consumes: build the layered
//     colour node over a surface, and re-listen for structural changes (blend/reorder).
//
// Sense-specific parameters stay pure uniform writes via the `senseControls`
// descriptors (rendered by the dev-console sense panel).

import type { Node } from "three/webgpu";
import { Color } from "three/webgpu";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { isBlendMode } from "./blend-modes.ts";
import { type SenseControlsDescriptor, senseControls } from "./controls.ts";
import { SenseSystem } from "./sense-system.ts";
import { SHADER_SENSE_KEYS, type ShaderSenseKey } from "./sense-types.ts";
import type { SurfaceDesc } from "./surface.ts";
import { uTime } from "./uniforms.ts";

export { BLEND_MODES, getBlend, isBlendMode } from "./blend-modes.ts";
export type { BlendFn, BlendMode, BlendModeKey } from "./blend-modes.ts";
export { senseControls } from "./controls.ts";
export type {
  CheckControl,
  ColorControl,
  PresetsControl,
  RangeControl,
  SenseControl,
  SenseControlsDescriptor,
} from "./controls.ts";
export { SenseSystem, SETTINGS_FORMAT } from "./sense-system.ts";
export type { SenseSettings } from "./sense-system.ts";
export { SHADER_SENSE_KEYS } from "./sense-types.ts";
export type { SenseUiMeta, ShaderSense, ShaderSenseKey } from "./sense-types.ts";
export { lambertLight, normalizeSurface, SUN_DIR } from "./surface.ts";
export type { SenseSurface, SurfaceDesc } from "./surface.ts";
export { foliageSheen, lichenBlotches, nectarGuide } from "./uv-signals.ts";
export { colorUniform, F, scalarUniform, uBaseColor, uTime } from "./uniforms.ts";
export type { ColorUniform, ParamUniform, ScalarUniform, Vec3Like } from "./uniforms.ts";
export {
  createDefaultSenses,
  createEcholocation,
  createFarben,
  createThermalSicht,
  createUV,
} from "./senses/index.ts";

/** Seconds a layer takes to ease fully in/out when its signal flips 0 ↔ 1. */
const LAYER_EASE_SECONDS = 2.5;

/** The structural interface the terrain material consumes (declared terrain-side too —
 *  structurally identical, so no import direction terrain → senses is needed). */
export interface ShaderLayerCompositor {
  buildColorNode(surface: SurfaceDesc): Node<"vec3">;
  onStructureChange(cb: () => void): () => void;
}

export interface ShaderSenses {
  /** The compositor + registry (order, blend modes, serialization). */
  readonly system: SenseSystem;
  /** Structural compositing interface for the terrain material. */
  readonly compositor: ShaderLayerCompositor;
  /** Control descriptors for the shared sense UI, in current layer order. */
  controls(): SenseControlsDescriptor[];
  /** Ease layer activations toward their signals, feed the spine time. Once per frame. */
  update(dt: number): void;
  dispose(): void;
}

/** Narrow a bus payload to `{ id, … }` where id is one of this module's senses. */
function readPayload(payload: unknown): Map<string, unknown> | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const map = new Map<string, unknown>(Object.entries(payload));
  const id = map.get("id");
  return typeof id === "string" && (SHADER_SENSE_KEYS as readonly string[]).includes(id)
    ? map
    : null;
}

/**
 * Route the shared sense-UI bus commands into this module (the "commands travel over
 * the signal solution" rule): `sense:param {id,key,value}` writes a live uniform,
 * `sense:blend {id,mode}` and `sense:move {id,dir}` are structural.
 */
function attachBusCommands(bus: Bus, system: SenseSystem): (() => void)[] {
  return [
    bus.on("sense:param", (payload) => {
      const p = readPayload(payload);
      if (!p) {
        return;
      }
      const sense = system.get(String(p.get("id")));
      const key = p.get("key");
      if (!sense || typeof key !== "string") {
        return;
      }
      const target =
        key === "opacity"
          ? sense.opacity
          : key === "range"
            ? sense.range
            : key === "rangeSoft"
              ? sense.rangeSoft
              : sense.params[key];
      if (!target) {
        return;
      }
      const value = p.get("value");
      if (typeof value === "number" && typeof target.value === "number") {
        target.value = value;
      } else if (typeof value === "boolean" && typeof target.value === "number") {
        target.value = value ? 1 : 0;
      } else if (typeof value === "string" && target.value instanceof Color) {
        target.value.set(value);
      }
    }),
    bus.on("sense:blend", (payload) => {
      const p = readPayload(payload);
      const mode = p?.get("mode");
      if (p && isBlendMode(mode)) {
        system.setBlend(String(p.get("id")), mode);
      }
    }),
    bus.on("sense:move", (payload) => {
      const p = readPayload(payload);
      const dir = p?.get("dir");
      if (p && typeof dir === "number") {
        system.move(String(p.get("id")), dir);
      }
    }),
  ];
}

export function createShaderSenses(bus: Bus): ShaderSenses {
  const system = new SenseSystem();

  // Layer targets follow the sense signals (coarse subscribe — event-rate writes).
  const targets: Record<ShaderSenseKey, number> = {
    farben: signals.sense.farben.peek(),
    echo: signals.sense.echo.peek(),
    infrarot: signals.sense.infrarot.peek(),
    uv: signals.sense.uv.peek(),
  };
  const unsubscribes = SHADER_SENSE_KEYS.map((key) =>
    signals.sense[key].subscribe((value) => {
      targets[key] = value;
    }),
  );
  unsubscribes.push(...attachBusCommands(bus, system));

  // Seed the uniforms to the current signal state (no opening fade on a hot start).
  for (const key of SHADER_SENSE_KEYS) {
    system.setEnabled(key, targets[key]);
  }

  return {
    system,
    compositor: {
      buildColorNode: (surface) => system.buildColorNode(surface),
      onStructureChange: (cb) => system.on(cb),
    },
    controls() {
      return system.senses.map((sense) => senseControls(sense, system));
    },
    update(dt: number): void {
      uTime.value = signals.time.peek();
      const maxStep = dt / LAYER_EASE_SECONDS;
      for (const sense of system.senses) {
        const current = typeof sense.enabled.value === "number" ? sense.enabled.value : 0;
        const target = targets[sense.key];
        const delta = target - current;
        if (delta !== 0) {
          const step = Math.min(Math.abs(delta), maxStep) * Math.sign(delta);
          sense.enabled.value = current + step;
        }
      }
    },
    dispose(): void {
      for (const off of unsubscribes) {
        off();
      }
    },
  };
}
