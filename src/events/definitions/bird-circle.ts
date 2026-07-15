// ── Becoming Many — Event: the bird circling the camera ────────
//
// The first scripted timeline event: a single bird (Erasmus' rigged model, a
// dedicated clone — no reach into the creatures module) flies the authored
// `bird-circle` route around the camera and departs. The route FBX is a
// Blender export of an animated Empty (position track), the same authoring
// pipeline as the bird_intro prototype; drop-in replaceable with a GLB.
//
// LOOK — deliberately NOT perception-gated: unlike the swarm birds (revealed
// only by the colour senses, main.ts frame loop), this bird is an authored
// dramaturgical moment that must land even in the white void before the first
// sense. It wears an always-visible unlit albedo, still composed with the
// distance fog + view reveal so it sits inside the void's depth instead of
// punching through it.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { mix, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { distanceFog, viewReveal } from "../../render/tsl-kit.ts";
import type { KitUniforms } from "../../render/uniforms.ts";
import { BirdFlight, type LoadedBirdModel } from "../bird-flight.ts";
import type { EventContext, EventDefinition, EventInstance } from "../types.ts";

/** Same rigged asset as the swarm (head faces −Z in the file, flap clip = [0]). */
const BIRD_MODEL_URL = "/creatures/bird_erasmus.glb";
/** The authored route (Blender Empty with a position track, see bird_intro). */
const ROUTE_URL = "/events/bird-circle.fbx";
/** Target wingspan in metres — a close fly-by reads well slightly bird-sized. */
const BIRD_WINGSPAN = 0.55;

/** Load a dedicated, event-owned bird instance with the always-visible look. */
async function loadEventBird(uniforms?: KitUniforms): Promise<LoadedBirdModel> {
  const gltf = await new GLTFLoader().loadAsync(BIRD_MODEL_URL);
  const model = cloneSkeleton(gltf.scene);
  const span = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).x;
  model.scale.setScalar(BIRD_WINGSPAN / Math.max(span, 1e-4));

  // UNLIT (the scene has no lights — a standard material renders black): the
  // model's own part colours as albedo, faded by fog/view-reveal only.
  const materials = new Map<string, THREE.MeshBasicNodeMaterial>();
  const materialFor = (source: THREE.Material): THREE.MeshBasicNodeMaterial => {
    const color =
      "color" in source && source.color instanceof THREE.Color
        ? source.color
        : new THREE.Color(0x8e98a8);
    const key = color.getHexString();
    const cached = materials.get(key);
    if (cached) return cached;

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    let base: Node<"vec3"> | Node<"color"> = vec3(color.r, color.g, color.b);
    if (uniforms) {
      const fogged = distanceFog(base, uniforms.fogColor, uniforms.fogNear, uniforms.fogFar);
      base = mix(
        uniforms.fogColor,
        fogged,
        viewReveal(uniforms.viewRadius, uniforms.revealSoftness),
      );
    }
    material.colorNode = base;
    materials.set(key, material);
    return material;
  };

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = Array.isArray(child.material) ? child.material[0] : child.material;
    if (source) child.material = materialFor(source);
  });

  return { scene: model, animations: gltf.animations };
}

export const birdCircleEvent: EventDefinition = {
  id: "birdCircle",
  label: "Vogel-Rundflug",
  create(ctx: EventContext): EventInstance {
    const flight = new BirdFlight(ctx.scene, {
      getBirdModel: () => loadEventBird(ctx.uniforms),
      anchor: ctx.anchor,
      parent: ctx.parent,
      pathUrl: ROUTE_URL,
      // Fly-by framing, fitted against the player's constant 6 m/s forward
      // glide (the bird_intro demo camera crept at 0.65 m/s, so its values
      // don't transfer): the route is WORLD-anchored at the trigger pose, the
      // bird approaches from front-left (~10 m), sweeps past ~2 m over the
      // head at t≈1.5 s and stays 2–4.5 m beside the flight line until the
      // exit — computed by sampling the authored track against the camera
      // path (see the fit in the module history; re-fit when player speed or
      // the route FBX changes).
      routeDuration: 3,
      exitDuration: 4.8,
      routeScale: 0.00125,
      routeStart: new THREE.Vector3(-5.44, 0.0, -9.13),
      // bird_erasmus.glb: head faces −Z (see src/creatures/index.ts) — align
      // that to the flight forward; roll offset re-tuned for this model.
      modelForward: new THREE.Vector3(0, 0, -1),
      modelRollOffset: 0,
    });

    return {
      load: () => flight.load(),
      trigger: () => void flight.play(),
      get playing() {
        return flight.playing;
      },
      update: (dt) => flight.update(dt),
      dispose: () => flight.dispose(),
    };
  },
};
