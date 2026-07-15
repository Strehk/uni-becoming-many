/**
 * Theatre.js project wiring (docs §4 + MASTERPLAN §4).
 *
 * Theatre is layered on top of the substrate as an **authored-envelope + live-tuning tool**, not
 * as the timeline owner. The clock owns time; Theatre's sequence playhead is *slaved* to it
 * (`sequence.position = clock.now`, only while the clock runs — so Studio can scrub freely when
 * paused for authoring). Theatre writes **only authored signals**, via {@link pumpAuthored} — the
 * one-writer law in code.
 *
 * The 'Timeline' sheet carries the ~300 s dramaturgy (length pinned in `state.json`):
 * the macro envelopes (`unrest`, `intensity`) plus one 0..1 envelope per sense layer —
 * Theatre switches senses on, layers them piece by piece and shapes their intensity over
 * the piece. The bridge writes the sense envelopes into `signals.sense[id]` only while
 * `signals.senseAuthority` is "theatre", so manual testing and the timeline use the SAME
 * signals without fighting.
 *
 * Flight *path* recording/playback is deliberately NOT part of this integration — the flight is
 * player-controlled only (the former 'Camera' sheet stub was dropped; `bindings.ts` stays
 * as a generic transform helper for scripted scene objects). The one flight *parameter* Theatre
 * does author is the altitude ceiling: a `flight` object whose `maxHeight` (metres above terrain)
 * retunes the player's airspace over the piece — an authored envelope like `unrest`/`intensity`,
 * not a recorded pose. It is written straight to the player rig, so it never touches the signal
 * substrate or {@link pumpAuthored} (which is only for authored *signals*).
 *
 * ⚠️ The official 3D extension `@theatre/r3f` is React-Three-Fiber only and unusable here (vanilla
 * `three/webgpu`, no React). We reconstruct its useful part in `bindings.ts`.
 *
 * Dev vs prod: in dev, `@theatre/studio` is dynamically imported (so it tree-shakes out of the
 * production bundle). The committed `state.json` is passed as the base state in both modes.
 * In Studio mode we keep Theatre's browser-persistent storage on so the sequence-editor zoom (the
 * ~300 s view) survives reloads; the cost is that after committing new keyframes Studio may open on
 * a stale browser draft and prompt "Use browser's state / Use disk state" (choose disk to reload).
 */
import { getProject, onChange, types } from "@theatre/core";
import type { ISheet, ISheetObject } from "@theatre/core";
import { MOVEMENTS } from "../audio/movements.ts";
import projectState from "./state.json";

const PROJECT_ID = "Becoming Many";

/** One authored 0..1 envelope per sense layer (keys = SenseId, see src/senses/ids.ts). */
const SENSE_ENVELOPES = {
  farben: types.number(0, { range: [0, 1] }),
  echo: types.number(0, { range: [0, 1] }),
  infrarot: types.number(0, { range: [0, 1] }),
  uv: types.number(0, { range: [0, 1] }),
  duft: types.number(0, { range: [0, 1] }),
  netzwerk: types.number(0, { range: [0, 1] }),
  motion: types.number(0, { range: [0, 1] }),
  magnetfeld: types.number(0, { range: [0, 1] }),
  rundum: types.number(0, { range: [0, 1] }),
};

/**
 * One authored 0..1 volume envelope per movement (keys = {@link MOVEMENTS} ids). Keyframing a
 * fade-in → plateau → fade-out shape lays the clip on the timeline as a length-bar (Theatre draws
 * the line between keyframes) and doubles as its live gain — the closest fit to a per-clip audio
 * track, since Theatre has no native waveform lane. Consumed by `createMovementScore`.
 */
const MOVEMENT_ENVELOPES = Object.fromEntries(
  MOVEMENTS.map((m) => [m.id, types.number(0, { range: [0, 1], label: m.label })]),
) as Record<(typeof MOVEMENTS)[number]["id"], ReturnType<typeof types.number>>;

/** One authored 0..1 trigger pulse per scripted event (keys = EventId, see
 *  src/events/ids.ts). An event fires on the rising edge (>0.5) — author a held
 *  plateau (~1–2 s at 1), not a one-frame spike, so scrubs into it still fire. */
const EVENT_TRIGGERS = {
  birdCircle: types.number(0, { range: [0, 1] }),
  batFlight: types.number(0, { range: [0, 1] }),
  mosquitoSwarm: types.number(0, { range: [0, 1] }),
};

/** The authored macro-envelope object's props. Extend as the dramaturgy grows. */
const ARC_PROPS = {
  unrest: types.number(0, { range: [0, 1] }),
  intensity: types.number(0, { range: [0, 1] }),
  senses: types.compound(SENSE_ENVELOPES),
  tracks: types.compound(MOVEMENT_ENVELOPES),
  events: types.compound(EVENT_TRIGGERS),
};

export type ArcObject = ISheetObject<typeof ARC_PROPS>;

/**
 * Authored flight parameters. `maxHeight` is the altitude ceiling in metres above the terrain
 * floor (see the player's `maxAltitude`) — keyframe it to open or tighten the airspace over the
 * piece. Default 100 matches the call-site option, so an un-keyframed timeline flies exactly as
 * before; the range only bounds Studio's slider (you can still type any value).
 */
const FLIGHT_PROPS = {
  maxHeight: types.number(100, { range: [10, 400], label: "Max Height (m)" }),
};

export type FlightObject = ISheetObject<typeof FLIGHT_PROPS>;

/**
 * Authored credits/thank-you screen. `opacity` (0..1) is the master fade of the end-of-piece
 * credits panel — keyframe it up near the end of the timeline to bring the panel in, back to 0
 * to dismiss it. "When it shows" is simply where the envelope rises; the panel content lives in
 * `src/experience/credits.ts`. Like `flight`, this is read straight into its subsystem each frame,
 * never onto the signal substrate (it is not an authored *signal*).
 */
const CREDITS_PROPS = {
  opacity: types.number(0, { range: [0, 1], label: "Credits Opacity" }),
};

export type CreditsObject = ISheetObject<typeof CREDITS_PROPS>;

export interface Theatre {
  /** Authored envelopes: unrest / intensity + the per-sense layer envelopes. */
  readonly arc: ArcObject;
  /** Authored flight parameters (the altitude ceiling); read each frame into the player rig. */
  readonly flight: FlightObject;
  /** Authored credits screen fade (0..1); read each frame into the credits subsystem. */
  readonly credits: CreditsObject;
  /** The timeline sheet whose sequence is slaved to the clock (~300 s dramaturgy). */
  readonly timeline: ISheet;
  /** Drive the timeline playhead. Call each frame **only while the clock is running**. */
  setPosition(seconds: number): void;
  /**
   * Halt Theatre's own sequence playback (e.g. Studio's play button), keeping the clock the sole
   * time authority. A no-op when nothing is self-playing — the clock normally freezes Theatre by
   * simply not advancing `setPosition`.
   */
  pauseSequence(): void;
  /**
   * Observe the sequence playhead (seconds). Fires whenever Theatre's position changes — including
   * when Studio scrubs it while the clock is paused. Returns an unsubscribe function. Lets the host
   * mirror a Studio scrub back into the clock so the two don't diverge.
   */
  onPositionChange(listener: (seconds: number) => void): () => void;
  dispose(): void;
}

// Only pass a base state once `state.json` actually holds authored content — an empty
// placeholder would just make Theatre warn.
function hasAuthoredState(state: unknown): boolean {
  return typeof state === "object" && state !== null && "sheetsById" in state;
}

/**
 * Initialise the Theatre project and (in dev) the Studio editor. Async because Studio is a dynamic
 * import and we await `project.ready` so authored state is applied before the first sequence read.
 */
export async function initTheatre(): Promise<Theatre> {
  const project = hasAuthoredState(projectState)
    ? getProject(PROJECT_ID, { state: projectState })
    : getProject(PROJECT_ID);

  const timeline = project.sheet("Timeline");
  const arc = timeline.object("arc", ARC_PROPS);
  const flight = timeline.object("flight", FLIGHT_PROPS);
  const credits = timeline.object("credits", CREDITS_PROPS);

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("studio") === "1") {
    // Dynamic import ⇒ @theatre/studio is excluded from the production bundle.
    const studio = (await import("@theatre/studio")).default;
    // Persistent storage on: Theatre remembers the sequence-editor zoom (its clipped-space range)
    // across reloads, so the timeline opens where you left it (e.g. the full ~300 s view) instead
    // of resetting to Theatre's built-in 0..10 s default every time. Trade-off: Studio also keeps a
    // browser draft of the authored state, so after committing new keyframes to state.json it may
    // open on the stale browser snapshot and prompt "Use browser's state / Use disk state" — pick
    // "Use disk state" to reload the committed file.
    studio.initialize({ usePersistentStorage: true });
    studio.setSelection([timeline, arc, flight, credits]);
    // Tip: `studio.createContentOfSaveFile("Becoming Many")` returns the state object to write
    // into src/theatre/state.json — the production save file — without the Studio export button.
  }

  await project.ready;

  return {
    arc,
    flight,
    credits,
    timeline,
    setPosition(seconds: number): void {
      timeline.sequence.position = seconds;
    },
    pauseSequence(): void {
      timeline.sequence.pause();
    },
    onPositionChange(listener: (seconds: number) => void): () => void {
      return onChange(timeline.sequence.pointer.position, listener);
    },
    dispose(): void {
      // Theatre core holds no per-project teardown; sheets/objects live for the page's lifetime.
      // Kept for symmetry with the other subsystems' handles.
    },
  };
}
