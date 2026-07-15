// ── Becoming Many — Scripted timeline events ────────────────────
//
// The coordinator for one-shot staged moments (first: the bird circling the
// camera). Events live on the SAME substrate as everything else:
//
//   Theatre `arc.events.<id>` (authored 0..1 pulse, keyframed on the timeline)
//     → `signals.events[<id>]` (authored cell, written only by the bridge)
//     → `bus.when` rising edge (>0.5), evaluated in `bus.tick()`  [REACT]
//     → `bus.emit("event:trigger", { id })`
//     → the event instance anchors at the presenting camera and plays.
//
// The dev panel (and any future system) triggers through the same
// `event:trigger` channel, so timeline and manual testing are one code path.
//
// SEEK SEMANTICS — events are fire-and-forget: `bus.when` re-arms every tick,
// so scrubbing back before an authored pulse and playing again re-fires it
// (the flight re-anchors and restarts — wanted for authoring). Jumping PAST a
// whole pulse in one seek misses it; author pulses as held plateaus (~1–2 s at
// 1) so a scrub landing inside still fires.
//
// Assets load in the background — a missing model/route never stalls boot;
// `trigger()` warns and no-ops until its event is ready.

import type * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";
import { batFlightEvent } from "./definitions/bat-flight.ts";
import { birdCircleEvent } from "./definitions/bird-circle.ts";
import { mosquitoSwarmEvent } from "./definitions/mosquito-swarm.ts";
import type { EventId } from "./ids.ts";
import type { AnchorPose, EventDefinition, EventGroundSource, EventInstance } from "./types.ts";

/** The event registry — a new animal/route is one import + one entry here. */
const DEFINITIONS: readonly EventDefinition[] = [
  birdCircleEvent,
  batFlightEvent,
  mosquitoSwarmEvent,
];

export interface Events {
  /** id + label of every registered event (drives the dev panel). */
  readonly ids: readonly { id: EventId; label: string }[];
  /** Advance playing events. Call with `clock.delta` (obeys pause/timeScale). */
  update(dt: number): void;
  dispose(): void;
}

export interface EventsOptions {
  scene: THREE.Scene;
  /** Where event roots live (pass the player rig so routes travel with the
   *  gliding player); defaults to the scene. */
  parent?: THREE.Object3D | undefined;
  /** Translation-only source for player-relative events. */
  positionSource?: THREE.Object3D | undefined;
  /** Optional streamed-terrain height source for ground-safe paths. */
  ground?: EventGroundSource | undefined;
  /** The underlying WebGPU renderer — for the VR-correct presenting camera. */
  renderer: THREE.WebGPURenderer;
  /** The mono app camera (the XR camera overrides it while presenting). */
  camera: THREE.PerspectiveCamera;
  bus: Bus;
  /** The live sense-look uniforms (fog / view reveal), optional. */
  uniforms?: KitUniforms;
}

export function createEvents(options: EventsOptions): Events {
  const { scene, parent, positionSource, ground, renderer, camera, bus, uniforms } = options;

  // The presenting camera's pose — the same XR rule as `syncCameraPos`
  // (src/render/camera-pos.ts): while a VR session presents, read the XR
  // camera's matrixWorld DIRECTLY (no getWorldPosition — it has no scene-graph
  // parent and would recompute from the local pose, dropping the rig).
  const anchor: AnchorPose = (position, quaternion) => {
    if (renderer.xr.isPresenting) {
      const xr = renderer.xr.getCamera();
      position.setFromMatrixPosition(xr.matrixWorld);
      quaternion.setFromRotationMatrix(xr.matrixWorld);
    } else {
      camera.getWorldPosition(position);
      camera.getWorldQuaternion(quaternion);
    }
  };

  interface Entry {
    definition: EventDefinition;
    instance: EventInstance;
    ready: boolean;
  }

  const entries = new Map<EventId, Entry>();
  for (const definition of DEFINITIONS) {
    const entry: Entry = {
      definition,
      instance: definition.create({ scene, bus, parent, positionSource, ground, anchor, uniforms }),
      ready: false,
    };
    entries.set(definition.id, entry);
    // Background load — boot never waits on an event asset.
    entry.instance
      .load()
      .then(() => {
        entry.ready = true;
      })
      .catch((error) => {
        console.warn(`[events] "${definition.id}" failed to load — trigger disabled`, error);
      });
  }

  const unsubscribes: (() => void)[] = [];

  // Authored trigger: rising edge of each event's timeline pulse → the bus.
  for (const id of entries.keys()) {
    unsubscribes.push(
      bus.when(
        signals.events[id],
        (v) => v > 0.5,
        () => bus.emit("event:trigger", { id }),
      ),
    );
  }

  // The one trigger channel — timeline, dev panel and future systems alike.
  unsubscribes.push(
    bus.on("event:trigger", (payload) => {
      const id = (payload as { id?: EventId } | undefined)?.id;
      const entry = id ? entries.get(id) : undefined;
      if (!entry) {
        console.warn("[events] unknown event trigger", payload);
        return;
      }
      if (!entry.ready) {
        console.warn(`[events] "${entry.definition.id}" not loaded yet — trigger ignored`);
        return;
      }
      console.info(`[events] trigger "${entry.definition.id}"`);
      entry.instance.trigger();
    }),
  );

  return {
    ids: DEFINITIONS.map(({ id, label }) => ({ id, label })),

    update(dt: number): void {
      for (const entry of entries.values()) {
        if (entry.instance.playing) {
          entry.instance.update(dt);
        }
      }
    },

    dispose(): void {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      for (const entry of entries.values()) {
        entry.instance.dispose();
      }
      entries.clear();
    },
  };
}
