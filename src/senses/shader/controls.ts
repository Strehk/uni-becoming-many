// ── Per-sense control descriptors — the UI-agnostic handover interface ──
//
// Ported from ShaderSinneModul `src/core/controls.js`. `senseControls(sense, system)`
// describes ALL adjustable controls of one sense as plain objects with live bindings
// onto the running uniforms. Any UI (the dev-console sense panel here) renders its
// widgets from this without knowing module internals — and everything stays adjustable
// because the bindings point straight at the uniforms (no shader recompile).
//
// Structural operations (blend mode, ordering) go through the system — they trigger a
// rebuild; everything else is a pure uniform write.

import { Color } from "three/webgpu";
import { BLEND_MODES, type BlendModeKey } from "./blend-modes.ts";
import type { SenseSystem } from "./sense-system.ts";
import type { ShaderSense } from "./sense-types.ts";
import type { ParamUniform } from "./uniforms.ts";

export interface RangeControl {
  type: "range";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  hardMin?: number;
  hardMax?: number;
  get(): number;
  set(v: number): void;
}

export interface ColorControl {
  type: "color";
  key: string;
  label: string;
  get(): string;
  set(hex: string): void;
}

export interface CheckControl {
  type: "check";
  key: string;
  label: string;
  get(): boolean;
  set(v: boolean): void;
}

export interface PresetsControl {
  type: "presets";
  label: string;
  options: { label: string; values: Record<string, string> }[];
  apply(values: Record<string, string>): void;
}

export type SenseControl = RangeControl | ColorControl | CheckControl | PresetsControl;

export interface SenseControlsDescriptor {
  key: string;
  label: string;
  description: string;
  toggle: { get(): boolean; set(v: boolean): void };
  blend: {
    options: { value: BlendModeKey; label: string }[];
    get(): BlendModeKey;
    set(mode: BlendModeKey): void;
  } | null;
  controls: SenseControl[];
}

function scalarOf(u: ParamUniform): number {
  return typeof u.value === "number" ? u.value : 0;
}

function rangeCtl(
  label: string,
  uniformNode: ParamUniform,
  spec: Omit<RangeControl, "type" | "label" | "get" | "set">,
): RangeControl {
  return {
    type: "range",
    label,
    ...spec,
    get: () => scalarOf(uniformNode),
    set: (v: number) => {
      uniformNode.value = v;
    },
  };
}

export function senseControls(
  sense: ShaderSense,
  system: SenseSystem | null = null,
): SenseControlsDescriptor {
  const common: SenseControl[] = [
    rangeCtl("Deckkraft", sense.opacity, {
      key: "opacity",
      min: 0,
      max: 1,
      step: 0.01,
      hardMin: 0,
      hardMax: 1,
    }),
    rangeCtl("Sichtweite", sense.range, {
      key: "range",
      min: 5,
      max: 600,
      step: 1,
      digits: 0,
      hardMin: 0,
    }),
    rangeCtl("Sicht-Rand", sense.rangeSoft, {
      key: "rangeSoft",
      min: 0,
      max: 200,
      step: 1,
      digits: 0,
      hardMin: 0,
    }),
  ];

  const specific: SenseControl[] = sense.ui.map((m): SenseControl => {
    if (m.type === "presets") {
      return {
        type: "presets",
        label: m.label,
        options: m.options,
        apply: (values) => {
          for (const [k, hex] of Object.entries(values)) {
            const u = sense.params[k];
            if (u && u.value instanceof Color) {
              u.value.set(hex);
            }
          }
        },
      };
    }
    const u = sense.params[m.key];
    if (!u) {
      throw new Error(`Sinn "${sense.key}": ui verweist auf unbekannten Parameter "${m.key}"`);
    }
    if (m.type === "color") {
      return {
        type: "color",
        key: m.key,
        label: m.label,
        get: () => (u.value instanceof Color ? `#${u.value.getHexString()}` : "#000000"),
        set: (hex: string) => {
          if (u.value instanceof Color) {
            u.value.set(hex);
          }
        },
      };
    }
    if (m.type === "check") {
      return {
        type: "check",
        key: m.key,
        label: m.label,
        get: () => scalarOf(u) > 0.5,
        set: (b: boolean) => {
          u.value = b ? 1 : 0;
        },
      };
    }
    return rangeCtl(m.label, u, {
      key: m.key,
      min: m.min,
      max: m.max,
      step: m.step,
      ...(m.digits === undefined ? {} : { digits: m.digits }),
      ...(m.hardMin === undefined ? {} : { hardMin: m.hardMin }),
      ...(m.hardMax === undefined ? {} : { hardMax: m.hardMax }),
    });
  });

  return {
    key: sense.key,
    label: sense.label,
    description: sense.description,
    toggle: {
      get: () => scalarOf(sense.enabled) > 0.5,
      set: (b: boolean) => {
        sense.enabled.value = b ? 1 : 0;
      },
    },
    blend: system
      ? {
          options: BLEND_MODES.map((m) => ({ value: m.key, label: m.label })),
          get: () => sense.blendMode,
          set: (mode: BlendModeKey) => system.setBlend(sense.key, mode),
        }
      : null,
    controls: [...common, ...specific],
  };
}
