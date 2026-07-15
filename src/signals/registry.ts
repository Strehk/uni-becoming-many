/**
 * The named signal registry — the single shared truth every producer writes and every consumer
 * reads (docs/time-signals-theatre-plan.md §3.2). Each cell is annotated with its **one writer**
 * (the anti-swamp law): authored cells are written only by Theatre (via the bridge), emergent
 * cells are computed by exactly one system. Nothing else may write them.
 *
 * If you add a cell, name its writer in the comment — that annotation *is* the ownership contract.
 */
import type { EventId } from "../events/ids.ts";
import type { SenseId } from "../senses/ids.ts";
import { type Signal, signal } from "./signal.ts";

/**
 * Player pose in world space. **Mutated in place** every frame (no per-frame allocation), so it is
 * a `peek`-only cell by construction — consumers read `signals.playerPose.peek()` in the hot path;
 * subscribing would never fire (same reference). WRITER: player update in main.ts.
 */
export interface PlayerPose {
  x: number;
  y: number;
  z: number;
}

/**
 * World-space anchor for spatial consumers. Mutated in place by its writer and read via `peek()`
 * in frame loops, same pattern as PlayerPose.
 */
export interface SpatialAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Who is allowed to write the per-sense intensities right now. */
export type SenseAuthority = "manual" | "theatre";

/** One trigger cell per timeline event, spelled out like the sense cells. */
function createEventCells(): Record<EventId, Signal<number>> {
  return {
    birdCircle: signal(0),
  };
}

/** One intensity cell per sense, spelled out so no cast is needed (the `as`-free zone). */
function createSenseCells(): Record<SenseId, Signal<number>> {
  return {
    farben: signal(0),
    echo: signal(0),
    infrarot: signal(0),
    uv: signal(0),
    duft: signal(0),
    netzwerk: signal(0),
    motion: signal(0),
    magnetfeld: signal(0),
    rundum: signal(0),
  };
}

export const signals = {
  // ── emergent (one system computes each) ──
  /** Virtual elapsed seconds. WRITER: Clock (published from main.ts after `clock.advance`). */
  time: signal(0),
  /** World position of the player rig, mutated in place. WRITER: player update. */
  playerPose: signal<PlayerPose>({ x: 0, y: 0, z: 0 }),
  /** Nearest scent-source positions per scent type. WRITER: main.ts Duft anchor sampler. */
  scentAnchors: signal<SpatialAnchor[]>([]),
  /**
   * Per-sense layer intensity 0..1 (0 = off). The senses are LAYERS — any combination may be
   * non-zero at once. WRITER: SenseDirector (manual bus commands) / Theatre bridge while
   * `senseAuthority` is "theatre" — the sanctioned paths onto the same cells, gated so
   * only one is live at a time.
   */
  sense: createSenseCells(),
  /** Who currently drives the sense layers. WRITER: sense UI / SenseDirector / start menu. */
  senseAuthority: signal<SenseAuthority>("theatre"),
  /** The dominant sense (highest intensity; "none" when all layers are off) — drives the
   *  atmosphere look. WRITER: SenseDirector. */
  activeSense: signal<SenseId | "none">("none"),
  /** Atmosphere-transition progress 0..1 (1 = settled). WRITER: SenseManager. */
  senseProgress: signal(1),
  /** ICAROS control signal strength 0..1. WRITER: icaros onOrientation. */
  controlQuality: signal(0),

  // ── authored (Theatre is the sole writer, via src/theatre/bridge.ts) ──
  /** Macro dramaturgical unrest 0..1 across the piece. WRITER: Theatre 'Timeline' sheet. */
  unrest: signal(0),
  /** Macro intensity 0..1 across the piece. WRITER: Theatre 'Timeline' sheet. */
  intensity: signal(0),
  /** Per-event trigger pulse 0..1 — a scripted event fires on the rising edge
   *  (>0.5, evaluated by the events module's `bus.when`). WRITER: Theatre
   *  'Timeline' sheet (via the bridge). */
  events: createEventCells(),
} as const;

export type Signals = typeof signals;
