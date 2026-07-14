/**
 * The signal & event substrate — the reactive backbone objects subscribe to and push onto.
 *
 * - {@link signal} / {@link Signal} — the reactive cell primitive.
 * - {@link signals} — the named registry (shared state, one writer each).
 * - {@link bus} — the event bus (emit / on / when-crossings / tick).
 *
 * See docs/time-signals-theatre-plan.md §3.
 */
export { signal } from "./signal.ts";
export type { Signal } from "./signal.ts";
export { signals } from "./registry.ts";
export type { PlayerPose, Signals, SpatialAnchor } from "./registry.ts";
export { bus, createBus } from "./bus.ts";
export type { Bus, EventHandler } from "./bus.ts";
