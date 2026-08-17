/**
 * Mount correction: which physical axis, in which sign, feeds pitch and roll.
 *
 * The M5 is strapped to the flight rig in whatever orientation the mount allows, so the raw
 * axes may be exchanged or reversed. Three independent booleans fix that. This is deliberately
 * *not* gain or offset — it only reshuffles axes, so the -1..1 contract is untouched.
 *
 * Applied **before** calibration (see `index.ts`), so a recorded neutral pose is stored in the
 * already-corrected frame and survives a later axis change without re-calibration.
 *
 * Ported from dweigend/Icaros_Host `src/lib/server/control/orientation-map.ts`.
 */
import type { AxisMap, ControlFrame } from "../protocol.ts";

export function applyAxisMap(control: ControlFrame, map: AxisMap): ControlFrame {
  let pitch = control.pitch;
  let roll = control.roll;

  if (map.swapPitchRoll) {
    [pitch, roll] = [roll, pitch];
  }
  // Inversion happens after the swap, so the flags describe the *output* axes, not the inputs.
  if (map.invertPitch) {
    pitch = -pitch;
  }
  if (map.invertRoll) {
    roll = -roll;
  }

  return { ...control, pitch, roll };
}

/** True when the map does anything at all — surfaced in the dev console. */
export function isActiveAxisMap(map: AxisMap): boolean {
  return map.swapPitchRoll || map.invertPitch || map.invertRoll;
}
