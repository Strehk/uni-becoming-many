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
 * Flight recording/playback is deliberately NOT part of this integration — the flight is
 * player-controlled only (the former 'Camera' sheet stub was dropped; `bindings.ts` stays
 * as a generic transform helper for scripted scene objects).
 *
 * ⚠️ The official 3D extension `@theatre/r3f` is React-Three-Fiber only and unusable here (vanilla
 * `three/webgpu`, no React). We reconstruct its useful part in `bindings.ts`.
 *
 * Dev vs prod: in dev, `@theatre/studio` is dynamically imported (so it tree-shakes out of the
 * production bundle). The committed `state.json` is passed as the base state in both modes.
 * In Studio mode we disable Theatre's browser-persistent draft cache so the editor opens on
 * the committed disk state instead of an old localStorage snapshot.
 */
import { getProject, types } from "@theatre/core";
import type { ISheet, ISheetObject } from "@theatre/core";
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

/** The authored macro-envelope object's props. Extend as the dramaturgy grows. */
const ARC_PROPS = {
  unrest: types.number(0, { range: [0, 1] }),
  intensity: types.number(0, { range: [0, 1] }),
  senses: types.compound(SENSE_ENVELOPES),
};

export type ArcObject = ISheetObject<typeof ARC_PROPS>;

export interface Theatre {
  /** Authored envelopes: unrest / intensity + the per-sense layer envelopes. */
  readonly arc: ArcObject;
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

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("studio") === "1") {
    // Dynamic import ⇒ @theatre/studio is excluded from the production bundle.
    const studio = (await import("@theatre/studio")).default;
    studio.initialize({ usePersistentStorage: false });
    studio.setSelection([timeline, arc]);
    // Tip: `studio.createContentOfSaveFile("Becoming Many")` returns the state object to write
    // into src/theatre/state.json — the production save file — without the Studio export button.
  }

  await project.ready;

  return {
    arc,
    timeline,
    setPosition(seconds: number): void {
      timeline.sequence.position = seconds;
    },
    pauseSequence(): void {
      timeline.sequence.pause();
    },
    dispose(): void {
      // Theatre core holds no per-project teardown; sheets/objects live for the page's lifetime.
      // Kept for symmetry with the other subsystems' handles.
    },
  };
}
