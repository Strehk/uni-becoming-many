/**
 * Senses — the perception layer of Becoming Many (docs/MASTERPLAN.md §4).
 *
 * Since the module integration, senses are **layers**, not exclusive modes: each of the
 * nine {@link SenseId}s has an intensity signal `signals.sense[id]` (0..1) and any
 * combination may be active at once. This module owns two things:
 *
 *   - the {@link createSenseDirector} wiring (bus commands → sense signals, dominant
 *     sense, `sense:changed` mirror) — see `director.ts`;
 *   - the **atmosphere** state machine below: fog / view-reveal / rim uniforms that the
 *     terrain + water materials read. The atmosphere can't blend nine ways at once, so it
 *     eases toward the profile of the *dominant* sense (`signals.activeSense`, written by
 *     the director), falling back to the white-out "none" profile when all layers are off.
 *
 * The per-sense *color* layers (ShaderSinneModul port) live in `senses/shader/` and are
 * composited inside the terrain material; this module only steers the shared atmosphere.
 */
import { uniform } from "three/tsl";
import { Color } from "three/webgpu";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";
import { createSenseDirector } from "./director.ts";
import { SENSE_LABELS, type SenseId } from "./ids.ts";
import { type ShaderSenses, createShaderSenses } from "./shader/index.ts";

export {
  AIR_ONLY_SENSES,
  SENSE_KEY_ORDER,
  SENSE_LABELS,
  SENSE_ORDER,
  SENSE_SYNTH_MAP,
  isSenseId,
} from "./ids.ts";
export type { SenseId } from "./ids.ts";
export { createSenseDirector } from "./director.ts";
export type { SenseDirector } from "./director.ts";

/** The atmosphere target the dominant sense eases toward. */
export type AtmosphereId = SenseId | "none";

export interface SenseProfile {
  id: AtmosphereId;
  label: string;
  /** How far you can see, in metres (the view-radius cutoff). */
  viewRadius: number;
  /** Width of the soft fade at the reveal edge, in metres. */
  revealSoftness: number;
  /** Quantized depth-band count ("papercut"); high ≈ continuous. */
  depthLevels: number;
  fogNear: number;
  fogFar: number;
  rimPower: number;
  rimStrength: number;
  /** Near-distance terrain tint (hex). */
  colorNear: number;
  /** Far-distance terrain tint (hex). */
  colorFar: number;
  /** Haze / void colour the world dissolves into (hex). */
  fogColor: number;
  /** Fresnel edge-glow colour (hex). */
  rimColor: number;
  /** Presence of the ambient dust motes, 0..1 — for senses that want a cleaner
   *  image. (The motes wear the sense's distance fog, so they are depth-true
   *  under echo; currently every profile keeps them at 1.) */
  dustStrength: number;
}

export const SENSE_PROFILES: Record<AtmosphereId, SenseProfile> = {
  // No sense active — sensory void / white-out: the world is culled, only pale fog remains.
  // (The ShaderSinne compositor mirrors this: all layers off ⇒ the white base colour.)
  none: {
    id: "none",
    label: "Leere (kein Sinn)",
    viewRadius: 60,
    revealSoftness: 40,
    depthLevels: 2,
    fogNear: 4,
    fogFar: 90,
    rimPower: 1,
    rimStrength: 0,
    colorNear: 0xf0f4ff,
    colorFar: 0xf0f4ff,
    fogColor: 0xf0f4ff,
    rimColor: 0xf0f4ff,
    dustStrength: 1,
  },
  // 1 — daylight colour vision: full-colour, near-continuous shading.
  farben: {
    id: "farben",
    label: SENSE_LABELS.farben,
    viewRadius: 500,
    revealSoftness: 60,
    depthLevels: 48,
    fogNear: 80,
    fogFar: 480,
    rimPower: 1.4,
    rimStrength: 0.25,
    colorNear: 0x8fa86a,
    colorFar: 0x6a7a88,
    fogColor: 0x0a0a14,
    rimColor: 0x9fc0ff,
    dustStrength: 1,
  },
  // 2 — bat sonar: a PURE camera depth map — near black, far white, nothing else.
  // The fog is WHITE and tracks the echo layer's near/far ramp, so distance haze,
  // the reveal edge and the empty sky all read as "far" (white) instead of
  // inverting the map; rim stays 0. The dust stays: its motes wear the same
  // distance fog, so each speck is exactly as pale as its distance demands.
  echo: {
    id: "echo",
    label: SENSE_LABELS.echo,
    viewRadius: 140,
    revealSoftness: 40,
    depthLevels: 7,
    fogNear: 2,
    fogFar: 140,
    rimPower: 3.0,
    rimStrength: 0,
    colorNear: 0x000000,
    colorFar: 0xffffff,
    fogColor: 0xffffff,
    rimColor: 0xffffff,
    dustStrength: 1,
  },
  // 3 — thermal: wide field, heat tint. Rim kept LOW: a strong warm fresnel edge
  // reads as sunset lighting, not as a temperature measurement.
  infrarot: {
    id: "infrarot",
    label: SENSE_LABELS.infrarot,
    viewRadius: 620,
    revealSoftness: 80,
    depthLevels: 12,
    fogNear: 80,
    fogFar: 600,
    rimPower: 2.2,
    rimStrength: 0.2,
    colorNear: 0xffb14e,
    colorFar: 0x3a0d52,
    fogColor: 0x180a14,
    rimColor: 0xff7a3c,
    dustStrength: 1,
  },
  // 4 — ultraviolet: violet dusk, revealed signals glow against it.
  uv: {
    id: "uv",
    label: SENSE_LABELS.uv,
    viewRadius: 520,
    revealSoftness: 70,
    depthLevels: 20,
    fogNear: 60,
    fogFar: 500,
    rimPower: 2.4,
    rimStrength: 0.5,
    colorNear: 0x3c2b5e,
    colorFar: 0x120a24,
    fogColor: 0x0a0614,
    rimColor: 0xb26bff,
    dustStrength: 1,
  },
  // 5 — smell / chemosense: an AIR-ONLY sense. The surfaces stay in the white
  // void (same numbers as `none` — white sky, no distance tint); all colour in
  // the picture comes from the scent plumes themselves drifting through the air.
  duft: {
    id: "duft",
    label: SENSE_LABELS.duft,
    viewRadius: 60,
    revealSoftness: 40,
    depthLevels: 2,
    fogNear: 4,
    fogFar: 90,
    rimPower: 1,
    rimStrength: 0,
    colorNear: 0xf0f4ff,
    colorFar: 0xf0f4ff,
    fogColor: 0xf0f4ff,
    rimColor: 0xf0f4ff,
    dustStrength: 1,
  },
  // 6 — collective / network: wide field, red accent over near-dark ground.
  netzwerk: {
    id: "netzwerk",
    label: SENSE_LABELS.netzwerk,
    viewRadius: 680,
    revealSoftness: 90,
    depthLevels: 14,
    fogNear: 90,
    fogFar: 640,
    rimPower: 2.6,
    rimStrength: 0.7,
    colorNear: 0xff5a6a,
    colorFar: 0x1a1030,
    fogColor: 0x0a0814,
    rimColor: 0xff5a6a,
    dustStrength: 1,
  },
  // 7 — motion vision: the still world sinks into darkness, only movement glows.
  motion: {
    id: "motion",
    label: SENSE_LABELS.motion,
    viewRadius: 420,
    revealSoftness: 60,
    depthLevels: 10,
    fogNear: 30,
    fogFar: 380,
    rimPower: 2.0,
    rimStrength: 0.35,
    colorNear: 0x1a222c,
    colorFar: 0x05070a,
    fogColor: 0x04050a,
    rimColor: 0x7f9fbf,
    dustStrength: 1,
  },
  // 8 — magnetoreception: cool auroral dusk, the sky carries the field.
  magnetfeld: {
    id: "magnetfeld",
    label: SENSE_LABELS.magnetfeld,
    viewRadius: 680,
    revealSoftness: 90,
    depthLevels: 16,
    fogNear: 90,
    fogFar: 640,
    rimPower: 2.2,
    rimStrength: 0.45,
    colorNear: 0x274038,
    colorFar: 0x101c2e,
    fogColor: 0x060a12,
    rimColor: 0x5cf0c8,
    dustStrength: 1,
  },
  // 9 — 360° vision: warm, wide, near-continuous — the projection does the work.
  rundum: {
    id: "rundum",
    label: SENSE_LABELS.rundum,
    viewRadius: 560,
    revealSoftness: 70,
    depthLevels: 32,
    fogNear: 80,
    fogFar: 520,
    rimPower: 1.5,
    rimStrength: 0.3,
    colorNear: 0x9aa06a,
    colorFar: 0x6a7a88,
    fogColor: 0x0c0a12,
    rimColor: 0xffd9a0,
    dustStrength: 1,
  },
};

/**
 * Build the live TSL atmosphere uniforms, seeded to `start`'s profile. These are real
 * `uniform()` nodes — bind them into a `*NodeMaterial` graph (`.colorNode`, fog, fresnel)
 * and the sense transitions drive shading for free. The return type is inferred so the
 * node math methods survive (same pattern as the terrain kit) — the terrain accepts this
 * object directly as its `KitUniforms`.
 */
export function createSenseUniforms(start: AtmosphereId) {
  const p = SENSE_PROFILES[start];
  return {
    viewRadius: uniform(p.viewRadius),
    revealSoftness: uniform(p.revealSoftness),
    depthLevels: uniform(p.depthLevels),
    fogNear: uniform(p.fogNear),
    fogFar: uniform(p.fogFar),
    rimPower: uniform(p.rimPower),
    rimStrength: uniform(p.rimStrength),
    colorNear: uniform(new Color(p.colorNear)),
    colorFar: uniform(new Color(p.colorFar)),
    fogColor: uniform(new Color(p.fogColor)),
    rimColor: uniform(new Color(p.rimColor)),
    dustStrength: uniform(p.dustStrength),
    /** Master world visibility 0..1 — 0 while no sense is active (the pale void),
     *  eased to 1 as senses reveal the world. The terrain + water gate on this. */
    worldReveal: uniform(start === "none" ? 0 : 1),
  };
}

/** The live atmosphere uniform set (inferred — keeps the TSL node methods). */
export type SenseUniforms = ReturnType<typeof createSenseUniforms>;

interface ScalarSnapshot {
  viewRadius: number;
  revealSoftness: number;
  depthLevels: number;
  fogNear: number;
  fogFar: number;
  rimPower: number;
  rimStrength: number;
  dustStrength: number;
  worldReveal: number;
}

/** Master world visibility a profile eases toward: 0 for the void, 1 for any sense. */
function revealTarget(id: AtmosphereId): number {
  return id === "none" ? 0 : 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Smooth ease-in-out so transitions accelerate then settle (no linear snap).
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The atmosphere transition engine. Lerps `uniforms` toward the target profile; publishes
 * `signals.senseProgress`. Driven by `signals.activeSense` (see {@link createSenses}).
 */
export class SenseManager {
  private readonly u: SenseUniforms;
  /** Seconds a full atmosphere transition takes. */
  duration = 4.5;

  private elapsed: number;
  private readonly from: ScalarSnapshot;
  private readonly fromColors: { near: Color; far: Color; fog: Color; rim: Color };
  private to: SenseProfile;
  private readonly toColors: { near: Color; far: Color; fog: Color; rim: Color };

  constructor(uniforms: SenseUniforms, start: AtmosphereId) {
    this.u = uniforms;
    this.to = SENSE_PROFILES[start];
    this.from = this.snapshotScalars();
    this.fromColors = { near: new Color(), far: new Color(), fog: new Color(), rim: new Color() };
    this.toColors = {
      near: new Color(this.to.colorNear),
      far: new Color(this.to.colorFar),
      fog: new Color(this.to.fogColor),
      rim: new Color(this.to.rimColor),
    };
    // Snap straight to the start profile — no opening transition.
    this.elapsed = this.duration;
    this.applyProfile(this.to);
  }

  get current(): SenseProfile {
    return this.to;
  }

  /** Begin easing toward `id` (idempotent if already heading there). */
  switchTo(id: AtmosphereId): void {
    if (id === this.to.id) {
      return;
    }
    this.beginTransition(SENSE_PROFILES[id]);
  }

  /** Lerp the live uniforms toward the target profile, publish progress. Call once per frame. */
  update(dt: number): void {
    if (this.elapsed >= this.duration) {
      if (signals.senseProgress.peek() !== 1) {
        signals.senseProgress.value = 1;
      }
      return; // settled — nothing to do
    }
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    const t = this.duration > 0 ? this.elapsed / this.duration : 1;

    // Styling leads the radius change so terrain is always styled before it becomes visible —
    // radius lags the rest by ~15%.
    const st = easeInOutCubic(t);
    const rt = easeInOutCubic(Math.min(Math.max((t - 0.15) / 0.85, 0), 1));

    this.u.viewRadius.value = lerp(this.from.viewRadius, this.to.viewRadius, rt);
    this.u.revealSoftness.value = lerp(this.from.revealSoftness, this.to.revealSoftness, st);
    this.u.depthLevels.value = lerp(this.from.depthLevels, this.to.depthLevels, st);
    this.u.fogNear.value = lerp(this.from.fogNear, this.to.fogNear, st);
    this.u.fogFar.value = lerp(this.from.fogFar, this.to.fogFar, st);
    this.u.rimPower.value = lerp(this.from.rimPower, this.to.rimPower, st);
    this.u.rimStrength.value = lerp(this.from.rimStrength, this.to.rimStrength, st);
    this.u.dustStrength.value = lerp(this.from.dustStrength, this.to.dustStrength, st);
    // Master reveal leads the styling (rt, the radius curve) so the world fades in from
    // the void slightly behind the atmosphere settling — and out ahead of it.
    this.u.worldReveal.value = lerp(this.from.worldReveal, revealTarget(this.to.id), st);

    this.u.colorNear.value.copy(this.fromColors.near).lerp(this.toColors.near, st);
    this.u.colorFar.value.copy(this.fromColors.far).lerp(this.toColors.far, st);
    this.u.fogColor.value.copy(this.fromColors.fog).lerp(this.toColors.fog, st);
    this.u.rimColor.value.copy(this.fromColors.rim).lerp(this.toColors.rim, st);

    signals.senseProgress.value = st;
  }

  private beginTransition(profile: SenseProfile): void {
    // Snapshot wherever the uniforms currently are (mid-transition included).
    Object.assign(this.from, this.snapshotScalars());
    this.fromColors.near.copy(this.u.colorNear.value);
    this.fromColors.far.copy(this.u.colorFar.value);
    this.fromColors.fog.copy(this.u.fogColor.value);
    this.fromColors.rim.copy(this.u.rimColor.value);

    this.to = profile;
    this.toColors.near.set(profile.colorNear);
    this.toColors.far.set(profile.colorFar);
    this.toColors.fog.set(profile.fogColor);
    this.toColors.rim.set(profile.rimColor);
    this.elapsed = 0;
    signals.senseProgress.value = 0;
  }

  private snapshotScalars(): ScalarSnapshot {
    return {
      viewRadius: this.u.viewRadius.value,
      revealSoftness: this.u.revealSoftness.value,
      depthLevels: this.u.depthLevels.value,
      fogNear: this.u.fogNear.value,
      fogFar: this.u.fogFar.value,
      rimPower: this.u.rimPower.value,
      rimStrength: this.u.rimStrength.value,
      dustStrength: this.u.dustStrength.value,
      worldReveal: this.u.worldReveal.value,
    };
  }

  private applyProfile(p: SenseProfile): void {
    this.u.viewRadius.value = p.viewRadius;
    this.u.revealSoftness.value = p.revealSoftness;
    this.u.depthLevels.value = p.depthLevels;
    this.u.fogNear.value = p.fogNear;
    this.u.fogFar.value = p.fogFar;
    this.u.rimPower.value = p.rimPower;
    this.u.rimStrength.value = p.rimStrength;
    this.u.dustStrength.value = p.dustStrength;
    this.u.worldReveal.value = revealTarget(p.id);
    this.u.colorNear.value.set(p.colorNear);
    this.u.colorFar.value.set(p.colorFar);
    this.u.fogColor.value.set(p.fogColor);
    this.u.rimColor.value.set(p.rimColor);
  }
}

export interface Senses {
  /** Live TSL atmosphere uniforms to bind into a terrain/material node graph. */
  readonly uniforms: SenseUniforms;
  /** The atmosphere transition engine. */
  readonly manager: SenseManager;
  /** The four terrain-composited colour senses (ShaderSinneModul port): compositor for
   *  the terrain material, control descriptors for the UI, signal-eased activation. */
  readonly shader: ShaderSenses;
  /** Advance the atmosphere transition + layer easing one frame. Call once per frame. */
  update(dt: number): void;
  dispose(): void;
}

export interface SensesOptions {
  /** Sense layers to start with (intensity 1). Defaults to `[]` — the piece opens in the
   *  white sensory void (all senses off ⇒ white world); the player / Theatre timeline
   *  reveal the perceptions from there. */
  start?: readonly SenseId[];
}

/**
 * Wire the sense layer system to the signal substrate.
 *
 * Senses are toggled via bus commands — the channel the dev UI, the Theatre timeline and any
 * future controller use — and the {@link createSenseDirector} turns commands into signal writes.
 * The atmosphere manager follows `signals.activeSense` (the dominant layer), so switching is fully
 * decoupled from *how* it was triggered.
 */
export function createSenses(bus: Bus, options: SensesOptions = {}): Senses {
  const director = createSenseDirector(bus);

  // Seed the starting layers (default: none — the white void).
  for (const id of options.start ?? []) {
    bus.emit("sense:set", { id, value: 1 });
  }

  const uniforms = createSenseUniforms(signals.activeSense.peek());
  const manager = new SenseManager(uniforms, signals.activeSense.peek());
  const shader = createShaderSenses(bus);

  // The manager follows the dominant sense — the one place atmosphere becomes a transition.
  const unsubscribe = signals.activeSense.subscribe((id) => manager.switchTo(id));

  return {
    uniforms,
    manager,
    shader,
    update(dt: number): void {
      manager.update(dt);
      shader.update(dt);
    },
    dispose(): void {
      unsubscribe();
      shader.dispose();
      director.dispose();
    },
  };
}
