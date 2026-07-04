/**
 * Theatre.js project wiring (docs §4).
 *
 * Theatre is layered on top of the substrate as an **authored-envelope + live-tuning tool**, not
 * as the timeline owner. The clock owns time; Theatre's sequence playhead is *slaved* to it
 * (`sequence.position = clock.now`, only while the clock runs — so Studio can scrub freely when
 * paused for authoring). Theatre writes **only authored signals**, via {@link pumpAuthored} — the
 * one-writer law in code.
 *
 * ⚠️ The official 3D extension `@theatre/r3f` is React-Three-Fiber only and unusable here (vanilla
 * `three/webgpu`, no React). We reconstruct its useful part — binding a scene object's transform
 * to a Theatre object — in `bindings.ts`. We keep the timeline, keyframes, property panel, easing,
 * and the exported `state.json`.
 *
 * Dev vs prod: in dev, `@theatre/studio` is dynamically imported (so it tree-shakes out of the
 * production bundle) and owns the project state via its own localStorage persistence — we pass no
 * base state. In prod, we load the committed `state.json` (once it has authored content) and never
 * touch Studio.
 */
import { getProject, types } from "@theatre/core";
import type { ISheet, ISheetObject } from "@theatre/core";
import projectState from "./state.json";

const PROJECT_ID = "Becoming Many";

/** The authored macro-envelope object's props (P3). Extend as the dramaturgy grows. */
const ARC_PROPS = {
  unrest: types.number(0, { range: [0, 1] }),
  intensity: types.number(0, { range: [0, 1] }),
};

export type ArcObject = ISheetObject<typeof ARC_PROPS>;

export interface Theatre {
  /** Authored envelopes: unrest / intensity across the piece. Read by {@link pumpAuthored}. */
  readonly arc: ArcObject;
  /** The timeline sheet whose sequence is slaved to the clock. */
  readonly timeline: ISheet;
  /** A sheet for scripted camera / object moves (bind via `bindings.ts`). */
  readonly camera: ISheet;
  /** Drive the timeline playhead. Call each frame **only while the clock is running**. */
  setPosition(seconds: number): void;
  dispose(): void;
}

// Only pass a base state in prod, and only once `state.json` actually holds authored content —
// an empty placeholder would just make Theatre warn. In dev, Studio owns the state.
function hasAuthoredState(state: unknown): boolean {
  return typeof state === "object" && state !== null && "sheetsById" in state;
}

/**
 * Initialise the Theatre project and (in dev) the Studio editor. Async because Studio is a dynamic
 * import and we await `project.ready` so authored state is applied before the first sequence read.
 */
export async function initTheatre(): Promise<Theatre> {
  const project =
    import.meta.env.DEV || !hasAuthoredState(projectState)
      ? getProject(PROJECT_ID)
      : getProject(PROJECT_ID, { state: projectState });

  const timeline = project.sheet("Timeline");
  const camera = project.sheet("Camera");
  const arc = timeline.object("arc", ARC_PROPS);

  if (import.meta.env.DEV) {
    // Dynamic import ⇒ @theatre/studio is excluded from the production bundle.
    const studio = (await import("@theatre/studio")).default;
    studio.initialize();
    // Tip: `studio.createContentOfSaveFile("Becoming Many")` returns the state object to write
    // into src/theatre/state.json — the production save file — without the Studio export button.
  }

  await project.ready;

  return {
    arc,
    timeline,
    camera,
    setPosition(seconds: number): void {
      timeline.sequence.position = seconds;
    },
    dispose(): void {
      // Theatre core holds no per-project teardown; sheets/objects live for the page's lifetime.
      // Kept for symmetry with the other subsystems' handles.
    },
  };
}
