/**
 * Behaviour — self-contained object instances whose actions emerge from the signal substrate
 * (docs §3.4). Each reads signals, listens on the bus, and pushes its own events with no central
 * wiring. The {@link createBeacon} example proves the pattern end-to-end.
 */
export { createBeacon } from "./beacon.ts";
export type { Beacon, BeaconOptions } from "./beacon.ts";
