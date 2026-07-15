// ── Becoming Many — Event: authored bat flight ─────────────────

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { mix, texture, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { distanceFog, viewReveal } from "../../render/tsl-kit.ts";
import type { KitUniforms } from "../../render/uniforms.ts";
import { BirdFlight, type LoadedBirdModel } from "../bird-flight.ts";
import type { EventContext, EventDefinition, EventInstance } from "../types.ts";

const BAT_MODEL_URL = "/creatures/bat_BS_rig.glb";
const BAT_PATH_URL = "/events/bat_path.glb";
const BAT_WINGSPAN = 0.7;
const BAT_PATH_DURATION = 10.416667;
const BAT_GROUND_CLEARANCE = 0.45;
const BAT_PATH_START = new THREE.Vector3(3.285576581954956, 1.0420538187026978, 2.665073871612549);
const BAT_PATH_INITIAL_DIRECTION = new THREE.Vector3(
  3.2842657566070557 - 3.285576581954956,
  0,
  -2.6652441024780273 - -2.665073871612549,
).normalize();
const BAT_PATH_ROTATION = new THREE.Quaternion().setFromUnitVectors(
  BAT_PATH_INITIAL_DIRECTION,
  new THREE.Vector3(0, 0, -1),
);

/** Load the dedicated skinned bat and preserve its embedded colour texture in
 * the same always-visible, fog-composed event look used by birdCircle. */
async function loadEventBat(uniforms?: KitUniforms): Promise<LoadedBirdModel> {
  const gltf = await new GLTFLoader().loadAsync(BAT_MODEL_URL);
  const model = cloneSkeleton(gltf.scene);
  const span = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).x;
  model.scale.setScalar(BAT_WINGSPAN / Math.max(span, 1e-4));

  const materials = new Map<string, THREE.MeshBasicNodeMaterial>();
  const materialFor = (source: THREE.Material): THREE.MeshBasicNodeMaterial => {
    const color =
      "color" in source && source.color instanceof THREE.Color
        ? source.color
        : new THREE.Color(0xffffff);
    const sourceMap = "map" in source && source.map instanceof THREE.Texture ? source.map : null;
    const key = `${color.getHexString()}:${sourceMap?.uuid ?? "none"}`;
    const cached = materials.get(key);
    if (cached) return cached;

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    let base: Node<"vec3"> | Node<"color"> = vec3(color.r, color.g, color.b);
    if (sourceMap) {
      base = base.mul(texture(sourceMap, uv()).rgb);
    }
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

export const batFlightEvent: EventDefinition = {
  id: "batFlight",
  label: "Fledermaus-Flug",
  create(ctx: EventContext): EventInstance {
    const flight = new BirdFlight(ctx.scene, {
      getBirdModel: () => loadEventBat(ctx.uniforms),
      anchor: ctx.anchor,
      parent: ctx.parent,
      positionSource: ctx.positionSource,
      alignToAnchorHeading: true,
      ground: ctx.ground,
      groundClearance: BAT_GROUND_CLEARANCE,
      pathUrl: BAT_PATH_URL,
      routeDuration: BAT_PATH_DURATION,
      exitDuration: 6,
      // BirdFlight scales around routeStart, so the path doubles in size while
      // its first point stays behind-right beside the player.
      routeScale: 2,
      routeRotation: BAT_PATH_ROTATION,
      routeStart: BAT_PATH_START,
      // The mesh uses +X as nose direction and +Y as its back/up axis.
      // After +X is aligned to the path tangent, this roll maps +Y to the
      // carrier's world-up side instead of letting the bat fly on its side.
      modelForward: new THREE.Vector3(1, 0, 0),
      modelRollOffset: -Math.PI / 2,
      flapClipName: "Armature.001Action",
      flapTimeScale: 1,
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
