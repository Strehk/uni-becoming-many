// ── Becoming Many — Proximity Awakening ────────────────────────
//
// The first real use of `bus.when()`: each streamed chunk of flora registers a
// rising-edge crossing on the player's distance to its centre, and stirs when the
// player first arrives. This is the "objects decide for themselves" pattern from
// docs/time-signals-theatre-plan.md §3.3 — the player knows nothing about flora,
// and flora emits nothing back.
//
// `signals.playerPose` is mutated in place, so it never notifies subscribers. That
// is fine here: `bus.when` re-evaluates its predicate against `sig.peek()` on every
// `tick()` rather than waiting for a change notification.
//
// Note that `when` arms itself with `was = predicate(peek())` at registration, so a
// chunk that streams in *underneath* the player does not fire — only a genuine
// crossing does. A plant you were already standing among was never startled.

import { type PlayerPose, bus, signals } from "../signals/index.ts";

/** Fraction of a chunk's edge, from its centre, that counts as "the player is here". */
const AWAKEN_RADIUS_FACTOR = 0.6;

/**
 * Fire `onEnter` the first time the player crosses into this chunk's neighbourhood.
 * Returns an unsubscribe — call it when the chunk streams out.
 */
export function watchChunkProximity(
  centreX: number,
  centreZ: number,
  chunkSize: number,
  onEnter: () => void,
): () => void {
  const radius = chunkSize * AWAKEN_RADIUS_FACTOR;
  const radiusSq = radius * radius;

  return bus.when(
    signals.playerPose,
    (pose: PlayerPose) => {
      const dx = pose.x - centreX;
      const dz = pose.z - centreZ;
      return dx * dx + dz * dz < radiusSq;
    },
    onEnter,
  );
}
