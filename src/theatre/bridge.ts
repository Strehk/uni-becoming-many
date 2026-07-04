/**
 * The authored → signal bridge (docs §4.5) — the *single sanctioned crossing* where Theatre writes
 * into the substrate. Theatre must only ever write **authored** signals; emergent cells
 * (`activeSense`, `playerPose`) are never touched here. That restriction is the one-writer law
 * expressed in code: if a value is set in this function, Theatre owns it, full stop.
 *
 * Called once per frame, after the sequence playhead has been positioned.
 */
import { signals } from "../signals/index.ts";
import type { ArcObject } from "./project.ts";

/** Copy the authored macro-envelope values into their signals. */
export function pumpAuthored(arc: ArcObject): void {
  const { unrest, intensity } = arc.value;
  signals.unrest.value = unrest;
  signals.intensity.value = intensity;
}
