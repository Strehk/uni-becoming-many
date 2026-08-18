// ── Becoming Many — Onboarding tasks (EXPERIMENT) ──────────────
//
// The lesson as a list of things the flier must actually DO, and the arithmetic that says
// how far along they are. Two decisions matter here:
//
//  1. **Progress is measured off the FLIGHT, never off the input.** A task is done when the
//     rig has really turned / really climbed — not when a key was pressed. That way the same
//     lesson works on the keyboard, on a phone's tilt and on the ICAROS machine without
//     knowing anything about them, and the feedback answers the question the flier actually
//     has: *is what I'm doing having an effect?*
//  2. **Progress can fall back.** Steering the wrong way undoes ground. Standing still does
//     not — a lesson waits, it does not run a clock on anyone.
//
// PURE DATA + arithmetic — no three, no DOM.

import type { ShapeId } from "./shapes.ts";

/** Where the flier is, this frame. Fed by the host from the player rig. */
export interface FlightSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Heading in radians, counter-clockwise seen from above. */
  readonly yaw: number;
}

export type TaskKind = "turn" | "climb" | "gate";

export interface TaskDef {
  readonly id: string;
  readonly kind: TaskKind;
  /** The sign shown while the task runs. */
  readonly shape: ShapeId;
  /** What is being asked, in one line — spoken by the piece, not by a manual. */
  readonly hint: string;
  /** +1 = right / up, -1 = left / down. Unused by gates. */
  readonly sign: 1 | -1;
  /** Radians of heading (turn) or metres of altitude (climb) that complete it. */
  readonly amount: number;
  /** Gate only: how far ahead it is planted, and its radius. */
  readonly distance?: number;
  readonly radius?: number;
  /**
   * The direction the sign dissolves FROM, in its own frame (+x right, +y up). As the task
   * is flown, motes on that side leave first and the sign eats itself away across to the
   * other side — fly left and the right-hand end blows away. Straight across the shape, not
   * along its strokes: what should read is the direction, not the drawing order.
   * `[0, 0]` means "does not dissolve" (the gates, which grow instead).
   */
  readonly dissolveFrom: readonly [number, number];
}

/**
 * The lesson: learn to steer, learn to climb and sink, then put it together by flying through
 * something. Arrows first, then real objects in the room — the sign teaches the gesture, the
 * gate asks for it.
 *
 * The climb/sink amounts are deliberately modest. The airspace has a ceiling (the player's
 * `maxAltitude`, which the timeline may lower further), and a task that asks for more height
 * than is left above the flier can never be finished — the sign would just sit there while
 * they hold the stick. Eight metres is unmistakable to fly and fits under any authored roof.
 */
export const TASKS: readonly TaskDef[] = [
  {
    id: "turn-right",
    kind: "turn",
    shape: "arrow-right",
    hint: "Nach rechts",
    sign: 1,
    amount: Math.PI * 0.5,
    dissolveFrom: [-1, 0], // flying right eats the sign from the left
  },
  {
    id: "turn-left",
    kind: "turn",
    shape: "arrow-left",
    hint: "Nach links",
    sign: -1,
    amount: Math.PI * 0.5,
    dissolveFrom: [1, 0],
  },
  {
    id: "climb",
    kind: "climb",
    shape: "arrow-up",
    hint: "Steigen",
    sign: 1,
    amount: 8,
    dissolveFrom: [0, -1],
  },
  {
    id: "sink",
    kind: "climb",
    shape: "arrow-down",
    hint: "Sinken",
    sign: -1,
    amount: 8,
    dissolveFrom: [0, 1],
  },
  {
    id: "gate-1",
    kind: "gate",
    shape: "ring",
    hint: "Hindurch",
    sign: 1,
    amount: 1,
    distance: 70,
    radius: 6,
    dissolveFrom: [0, 0], // a gate grows as you close on it; it does not eat away
  },
  {
    id: "gate-2",
    kind: "gate",
    shape: "ring",
    hint: "Und noch einmal",
    sign: 1,
    amount: 1,
    distance: 80,
    radius: 5,
    dissolveFrom: [0, 0],
  },
];

/** Shortest signed difference between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * What this frame added to the task, in the task's own unit (radians for a turn, metres for
 * a climb). Steering the wrong way returns a negative number, which is what lets the sign
 * fall back and so answer the stick honestly.
 *
 * Turning is accumulated PER FRAME rather than measured against the task's start: a
 * start-to-now angle can only express ±180°, so an eager flier who spins past that would see
 * their progress run backwards. Frame deltas are always small and never wrap.
 *
 * Altitude has no such wrap, but is accumulated the same way so that climbing 10 m, sinking
 * 10 m and climbing again does not count as "already done".
 */
export function taskGain(task: TaskDef, previous: FlightSample, now: FlightSample): number {
  if (task.kind === "turn") {
    // Turning RIGHT is clockwise seen from above, which is a DECREASING yaw (the rig yaws by
    // `-roll`), hence the negation — `sign: 1` means "to the right" in the flier's terms.
    return -angleDelta(previous.yaw, now.yaw) * task.sign;
  }
  if (task.kind === "climb") {
    return (now.y - previous.y) * task.sign;
  }
  return 0; // gates are measured by distance, not by accumulation
}

/** Progress of a gate: it fills as the ring grows in the view. */
export function gateProgress(
  now: FlightSample,
  gate: { x: number; y: number; z: number; startDistance: number },
): number {
  const dx = now.x - gate.x;
  const dy = now.y - gate.y;
  const dz = now.z - gate.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(0, Math.min(1, 1 - distance / Math.max(1, gate.startDistance)));
}

// Note: there is deliberately NO decay on standing still. Flying the wrong way gives ground
// back (a negative gain, see `taskGain`), which is the feedback that matters — but merely
// pausing to look around should not punish anyone. A task waits as long as it takes.
