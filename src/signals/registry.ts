/**
 * The named signal registry — the single shared truth every producer writes and every consumer
 * reads (docs/time-signals-theatre-plan.md §3.2). Each cell is annotated with its **one writer**
 * (the anti-swamp law): authored cells are written only by Theatre (via the bridge), emergent
 * cells are computed by exactly one system. Nothing else may write them.
 *
 * If you add a cell, name its writer in the comment — that annotation *is* the ownership contract.
 */
import type { SenseId } from "../senses/index.ts";
import { signal } from "./signal.ts";

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

export const signals = {
  // ── emergent (one system computes each) ──
  /** Virtual elapsed seconds. WRITER: Clock (published from main.ts after `clock.advance`). */
  time: signal(0),
  /** World position of the player rig, mutated in place. WRITER: player update. */
  playerPose: signal<PlayerPose>({ x: 0, y: 0, z: 0 }),
  /** The sense we are transitioning toward. WRITER: sense input (keys / controller). */
  activeSense: signal<SenseId>("normal"),
  /** Sense-transition progress 0..1 (1 = settled). WRITER: SenseManager. */
  senseProgress: signal(1),
  /** ICAROS control signal strength 0..1. WRITER: icaros onOrientation. */
  controlQuality: signal(0),

  // ── authored (Theatre is the sole writer, via src/theatre/bridge.ts) ──
  /** Macro dramaturgical unrest 0..1 across the piece. WRITER: Theatre 'Timeline' sheet. */
  unrest: signal(0),
  /** Macro intensity 0..1 across the piece. WRITER: Theatre 'Timeline' sheet. */
  intensity: signal(0),
} as const;

export type Signals = typeof signals;
