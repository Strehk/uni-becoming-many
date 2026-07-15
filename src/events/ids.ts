// ── Becoming Many — Event ids ───────────────────────────────────
//
// The shared id list for the scripted timeline events, mirroring
// `src/senses/ids.ts`: theatre (authored trigger props), the signal registry
// (authored cells) and the events module (definitions) all key off this one
// list, without circular imports. Adding an event = adding its id here plus a
// definition file under `src/events/definitions/`.

export const EVENT_IDS = ["birdCircle"] as const;

export type EventId = (typeof EVENT_IDS)[number];
