// ── SenseSystem — registry + compositor of the shader senses ───
//
// Ported from ShaderSinneModul `src/core/senseSystem.js`. Holds the active senses in
// application order and layers them over the white base:
//
//   out = uBaseColor (paper white)
//   per sense (in order):
//     reach = 1 − smoothstep(range − rangeSoft, range, surface.distance)   // bubble
//     out   = mix(out, blend(out, sense.build(surface)), opacity·enabled·reach)
//
// All senses off ⇒ the pale base. Activation is a UNIFORM (`enabled`) — layering
// piece by piece costs no shader recompile. Only changing a blend mode or reordering
// is structural (→ rebuild, published via `on`; the terrain material listens).

import { mix, oneMinus, smoothstep } from "three/tsl";
import type { Node } from "three/webgpu";
import { type BlendModeKey, getBlend, isBlendMode } from "./blend-modes.ts";
import { dumpParams, loadParams } from "./param-tree.ts";
import type { ShaderSense, ShaderSenseKey } from "./sense-types.ts";
import { createDefaultSenses } from "./senses/index.ts";
import { type SurfaceDesc, normalizeSurface } from "./surface.ts";
import { uBaseColor } from "./uniforms.ts";

export const SETTINGS_FORMAT = "becoming-many-senses";

interface SenseSnapshot {
  enabled: boolean;
  opacity: number;
  range: number;
  rangeSoft: number;
  blendMode: BlendModeKey;
  params: Record<string, string | number>;
}

export interface SenseSettings {
  format: typeof SETTINGS_FORMAT;
  version: 1;
  name: string;
  base: { color: string };
  order: string[];
  senses: Record<string, SenseSnapshot>;
}

function scalar(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

export class SenseSystem {
  readonly senses: ShaderSense[];
  private readonly listeners = new Set<() => void>();
  private batchDepth = 0;
  private dirty = false;
  private readonly defaults: SenseSettings;

  constructor(senses?: ShaderSense[]) {
    this.senses = senses ?? createDefaultSenses();
    this.defaults = this.serialize("defaults");
  }

  // ── events (structural changes only — the terrain rebuilds its colorNode on these) ──
  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    if (this.batchDepth > 0) {
      this.dirty = true;
      return;
    }
    for (const cb of [...this.listeners]) {
      cb();
    }
  }

  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.dirty) {
        this.dirty = false;
        this.emit();
      }
    }
  }

  // ── access ──
  get(key: ShaderSenseKey | string): ShaderSense | undefined {
    return this.senses.find((s) => s.key === key);
  }

  /** Activation — a uniform write, deliberately NO event (layering without hitches). */
  setEnabled(key: string, on: boolean | number): void {
    const s = this.get(key);
    if (s) {
      s.enabled.value = typeof on === "number" ? Math.min(1, Math.max(0, on)) : on ? 1 : 0;
    }
  }

  setOpacity(key: string, v: number): void {
    const s = this.get(key);
    if (s) {
      s.opacity.value = v;
    }
  }

  /** Structural — triggers a shader rebuild. */
  setBlend(key: string, mode: BlendModeKey): void {
    const s = this.get(key);
    if (!s || !isBlendMode(mode) || s.blendMode === mode) {
      return;
    }
    s.blendMode = mode;
    this.emit();
  }

  /** dir: +1 = applied later ("higher"), −1 = earlier. Structural. */
  move(key: string, dir: number): void {
    const i = this.senses.findIndex((s) => s.key === key);
    const j = i + Math.sign(dir);
    if (i === -1 || j < 0 || j >= this.senses.length) {
      return;
    }
    const a = this.senses[i];
    const b = this.senses[j];
    if (!a || !b) {
      return;
    }
    this.senses[i] = b;
    this.senses[j] = a;
    this.emit();
  }

  // ── compositing ──
  buildColorNode(surfaceDesc: SurfaceDesc = {}): Node<"vec3"> {
    const surface = normalizeSurface(surfaceDesc);
    let out: Node<"vec3"> = uBaseColor.rgb;
    for (const s of this.senses) {
      const col = s.build(surface);
      // Perception bubble: full effect up to `range`, soft fade behind (base beyond).
      const reach = oneMinus(
        smoothstep(s.range.sub(s.rangeSoft).max(0.0), s.range, surface.distance),
      );
      const blended = getBlend(s.blendMode)(out, col);
      out = mix(out, blended, s.opacity.mul(s.enabled).mul(reach));
    }
    return out;
  }

  // ── serialization (format "becoming-many-senses", tolerant on load) ──
  serialize(name = ""): SenseSettings {
    const senses: Record<string, SenseSnapshot> = {};
    for (const s of this.senses) {
      senses[s.key] = {
        enabled: scalar(s.enabled.value) > 0.5,
        opacity: scalar(s.opacity.value),
        range: scalar(s.range.value),
        rangeSoft: scalar(s.rangeSoft.value),
        blendMode: s.blendMode,
        params: dumpParams(s.params),
      };
    }
    return {
      format: SETTINGS_FORMAT,
      version: 1,
      name,
      base: { color: `#${uBaseColor.value.getHexString()}` },
      order: this.senses.map((s) => s.key),
      senses,
    };
  }

  apply(data: unknown): this {
    if (
      typeof data !== "object" ||
      data === null ||
      !("format" in data) ||
      data.format !== SETTINGS_FORMAT
    ) {
      throw new Error('Kein gültiger Sinnes-Zustand (format "becoming-many-senses" fehlt)');
    }
    const source = new Map<string, unknown>(Object.entries(data));
    this.batch(() => {
      const base = source.get("base");
      if (typeof base === "object" && base !== null && "color" in base) {
        const color = base.color;
        if (typeof color === "string") {
          uBaseColor.value.set(color);
        }
      }
      // Adopt the order (unknown keys ignored, missing ones appended). Structural.
      const order = source.get("order");
      if (Array.isArray(order)) {
        const rank = new Map<unknown, number>(order.map((k, i) => [k, i]));
        this.senses.sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99));
        this.dirty = true;
      }
      const senseData = source.get("senses");
      const senseMap = new Map<string, unknown>(
        typeof senseData === "object" && senseData !== null ? Object.entries(senseData) : [],
      );
      for (const s of this.senses) {
        const sd = senseMap.get(s.key);
        if (typeof sd !== "object" || sd === null) {
          continue;
        }
        const entry = new Map<string, unknown>(Object.entries(sd));
        s.enabled.value = entry.get("enabled") === true ? 1 : 0;
        const opacity = entry.get("opacity");
        if (typeof opacity === "number") {
          s.opacity.value = opacity;
        }
        const range = entry.get("range");
        if (typeof range === "number") {
          s.range.value = range;
        }
        const rangeSoft = entry.get("rangeSoft");
        if (typeof rangeSoft === "number") {
          s.rangeSoft.value = rangeSoft;
        }
        const blend = entry.get("blendMode");
        if (isBlendMode(blend) && blend !== s.blendMode) {
          s.blendMode = blend;
          this.dirty = true;
        }
        loadParams(s.params, entry.get("params"));
      }
    });
    return this;
  }

  reset(): void {
    this.apply(this.defaults);
  }
}
