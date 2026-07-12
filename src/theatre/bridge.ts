/**
 * The authored → signal bridge (docs §4.5 + MASTERPLAN §4) — the *single sanctioned
 * crossing* where Theatre writes into the substrate. Theatre must only ever write
 * **authored** signals; emergent cells (`activeSense`, `playerPose`) are never touched
 * here.
 *
 * Two tiers:
 *   - the macro envelopes (`unrest`, `intensity`) are unconditionally Theatre-owned;
 *   - the per-sense layer envelopes write `signals.sense[id]` ONLY while
 *     `signals.senseAuthority` is "theatre". Manual testing (bus commands → the
 *     SenseDirector) flips the authority to "manual", and the start menu's saved
 *     experience config flips it to "config". Those writers share the same cells
 *     without writing in the same frame — the one-writer law, gated.
 *
 * Called once per frame, after the sequence playhead has been positioned.
 */
import { SENSE_ORDER } from "../senses/ids.ts";
import { signals } from "../signals/index.ts";
import type { ArcObject } from "./project.ts";

/** Copy the authored envelope values into their signals. */
export function pumpAuthored(arc: ArcObject): void {
  const { unrest, intensity, senses } = arc.value;
  signals.unrest.value = unrest;
  signals.intensity.value = intensity;

  if (signals.senseAuthority.peek() === "theatre") {
    for (const id of SENSE_ORDER) {
      signals.sense[id].value = senses[id];
    }
  }
}
