/**
 * Theatre.js integration — authored envelopes + live tuning, slaved to the clock (docs §4).
 *
 * - {@link initTheatre} — create the project (+ dev-only Studio), returns the {@link Theatre} handle.
 * - {@link pumpAuthored} — the one sanctioned bridge writing authored Theatre values into signals.
 * - {@link transformProps} / {@link applyTransform} — the vanilla `@theatre/r3f` stand-in.
 */
export { initTheatre } from "./project.ts";
export type { Theatre, ArcObject, CreditsObject } from "./project.ts";
export { pumpAuthored } from "./bridge.ts";
export { transformProps, applyTransform } from "./bindings.ts";
export type { TransformValue } from "./bindings.ts";
