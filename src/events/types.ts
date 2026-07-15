// ── Becoming Many — Event module contracts ──────────────────────
//
// A scripted event is a short, one-shot staged moment (the first: a bird
// circling the camera on an authored route). Events are fire-and-forget: the
// Theatre timeline (or the dev panel) triggers them over the bus, they play
// out and hide themselves. Definitions are registered in `src/events/index.ts`.

import type * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { Bus } from "../signals/index.ts";
import type { EventId } from "./ids.ts";

/**
 * Copy the *presenting* camera's world pose into the given targets — the XR
 * headset while a VR session runs, the mono app camera otherwise (the same
 * distinction `syncCameraPos` makes). Events anchor their routes here.
 */
export type AnchorPose = (position: THREE.Vector3, quaternion: THREE.Quaternion) => void;
export type EventGroundSource = (x: number, z: number) => number | null;

/** Everything the host hands an event definition at creation time. */
export interface EventContext {
  /** The scene graph — events parent their own root group into it. */
  scene: THREE.Scene;
  /** Shared event/sense substrate for dynamic integrations. */
  bus: Bus;
  /**
   * Where event roots live; defaults to the scene. Pass the player RIG so a
   * camera-anchored route travels with the constantly-gliding player instead
   * of falling behind within a second (rig, not head — in VR the headset must
   * stay free to look around the route).
   */
  parent?: THREE.Object3D | undefined;
  /** Optional translation-only source for routes that follow player XYZ while
   * ignoring camera/head pose and every source rotation. */
  positionSource?: THREE.Object3D | undefined;
  /** Streamed terrain height for events that must stay above ground. */
  ground?: EventGroundSource | undefined;
  /** The presenting-camera pose provider (VR-correct, see {@link AnchorPose}). */
  anchor: AnchorPose;
  /** The live sense-look uniforms (distance fog / view reveal), optional. */
  uniforms?: KitUniforms | undefined;
}

/** One live event: loaded once at startup, triggered any number of times. */
export interface EventInstance {
  /** Load the event's assets (model, route). Called once, in the background. */
  load(): Promise<void>;
  /** Anchor at the current camera pose and play. Re-triggering restarts. */
  trigger(): void;
  /** True while the event is playing out. */
  readonly playing: boolean;
  /** Advance the event. Called with the virtual-clock delta (obeys pause). */
  update(dt: number): void;
  dispose(): void;
}

/** A registered event kind — future animals/routes are new definitions. */
export interface EventDefinition {
  readonly id: EventId;
  /** Human-readable name for the dev panel. */
  readonly label: string;
  create(ctx: EventContext): EventInstance;
}
