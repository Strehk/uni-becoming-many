/**
 * Physical safety clamp for the published control stream.
 *
 * The Icaros is a flight machine with a person lying on it. A controller that reconnects while
 * already tilted hard over, or one that jumps across the whole range in a single frame, must not
 * make the glider dive: those frames are flattened to neutral, and control resumes from the next
 * plausible frame. Button edges still pass through — a safety clamp on steering should not
 * swallow the rider's input.
 *
 * Ported verbatim (logic and constants) from dweigend/Icaros_Host
 * `src/lib/server/control/safety.ts`.
 */
import { type ControlFrame, createNeutralControl } from "../protocol.ts";

/** Resuming above this deflection is treated as an unsafe pose, not as intent. */
const EXTREME_RESUME_UNIT = 0.85;

/** A single-frame change this large is a glitch, not a human movement. */
const EXTREME_STEP_UNIT = 0.9;

export function protectControl(previous: ControlFrame, next: ControlFrame): ControlFrame {
  if (next.quality <= 0) {
    return neutralKeepingButton(next);
  }

  if (previous.quality <= 0 && isExtreme(next)) {
    return neutralKeepingButton(next);
  }

  if (previous.quality > 0 && hasAbruptStep(previous, next)) {
    return neutralKeepingButton(next);
  }

  return next;
}

function neutralKeepingButton(control: ControlFrame): ControlFrame {
  return {
    ...createNeutralControl(),
    buttonPressed: control.buttonPressed,
    buttonDown: control.buttonDown,
    buttonUp: control.buttonUp,
  };
}

function isExtreme(control: ControlFrame): boolean {
  return (
    Math.abs(control.pitch) >= EXTREME_RESUME_UNIT || Math.abs(control.roll) >= EXTREME_RESUME_UNIT
  );
}

function hasAbruptStep(previous: ControlFrame, next: ControlFrame): boolean {
  return (
    Math.abs(next.pitch - previous.pitch) >= EXTREME_STEP_UNIT ||
    Math.abs(next.roll - previous.roll) >= EXTREME_STEP_UNIT
  );
}
