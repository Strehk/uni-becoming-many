// ── Becoming Many — Creatures substrate ────────────────────────
//
// The host-side actor layer the perception modules read from (MASTERPLAN §4, S7).
// The swarm/network prototypes deliberately ship NO creatures of their own — the
// host provides them:
//
//   - **boids bird flocks** (procedurally animated wing flap, terrain-aware).
//     Flocking follows the classic Reynolds model as implemented by
//     github.com/juanuys/boids: separation / alignment / cohesion against
//     flockmates, a WANDERING GOAL each flock seeks ("migratory urge" — a
//     waypoint re-rolled when reached), and a soft boundary that steers
//     far-strayed birds back. Several independent flocks roam a wide radius
//     around the player, so swarms drift near and far instead of orbiting the
//     camera. The `netzwerk` sense reads the birds as network nodes; the
//     `motion` sense samples their animated vertices — the meshes themselves
//     stay hidden (perception-only creatures).
//   - **mushroom spawn points** scattered on the terrain around the player (the
//     mycelium network's anchors). Re-anchored when the player flies on; a
//     `creatures:mushrooms-changed` bus event tells consumers to rebuild.
//
// Everything here is plain world state — no sense logic, no signal writes except
// the mushroom-change event. Visual senses subscribe to what they need.

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import {
  float,
  mix,
  modelPosition,
  modelRadius,
  normalWorld,
  positionView,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { DEFAULT_CONFIG, type FaunaConfig, normalizeFaunaConfig } from "../flora-fauna/config.ts";
import type { FloraLayerCompositor } from "../life/material.ts";
import { distanceFog, viewReveal } from "../render/tsl-kit.ts";
import type { KitUniforms } from "../render/uniforms.ts";
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";
import type { ChunkBuiltInfo, ChunkCell } from "../terrain/index.ts";
import { type MosquitoFlocks, createMosquitoFlocks } from "./mosquito-flocks.ts";

// ── Flock layout ──
// Each flock roams its own distance RING around the player: the near flocks stay
// close enough that their motion trails are always experienceable, the far ones
// range wide ("schön weit rumfliegen") and only sweep past now and then. Rings
// are interpolated from NEAR to FAR across `flockCount` flocks (config-driven),
// scaled by `roamScale`, and kept inside the streamed-terrain window (keepRadius
// 3 × 256 m chunks) so `ground()` almost always answers.
const NEAR_RING = { min: 35, max: 130 };
const FAR_RING = { min: 150, max: 280 };

/** The roam ring for flock `i` of `count`, scaled by `roamScale`. */
function ringFor(i: number, count: number, roamScale: number): { min: number; max: number } {
  const t = count <= 1 ? 0 : i / (count - 1);
  return {
    min: (NEAR_RING.min + (FAR_RING.min - NEAR_RING.min) * t) * roamScale,
    max: (NEAR_RING.max + (FAR_RING.max - NEAR_RING.max) * t) * roamScale,
  };
}

/** A bird farther than its ring + this margin from the player is steered back
 *  hard (the juanuys boundary rule — there: outside the sphere, wander ×20). */
const BOUNDARY_MARGIN = 80;
/** A flock re-rolls its waypoint when its centroid gets this close to it… */
const WAYPOINT_REACHED = 40;
/** …or after this many seconds (a flock that fights headwind still moves on). */
const WAYPOINT_TIMEOUT = 35;

// ── Boids tuning (adapted from juanuys/boids to metres + our speeds) ──
const SEPARATION_RADIUS = 4;
const ALIGNMENT_RADIUS = 14;
const COHESION_RADIUS = 22;
const SEEK_WEIGHT = 0.9;
const MIN_SPEED = 5;
const MAX_SPEED = 13;
/** Acceleration clamp, m/s² (juanuys: maxForce = delta·5 against maxSpeed 5). */
const MAX_FORCE = 30;

const MIN_ALTITUDE = 8; // metres above ground
const MAX_ALTITUDE = 60;

/** The rigged bird asset (Erasmus' model). Head faces −Z in the file — the
 *  wrapper is turned 180° so our +Z flight forward matches; the armature's
 *  single clip (flap cycle) plays per bird with jittered phase/tempo. */
const BIRD_MODEL_URL = "/creatures/bird_erasmus.glb";
const DEER_MODEL_URL = "/creatures/deer_walk.glb";
/** Rigged, walking fox — roams the terrain on the same waypoint logic as the deer. */
const FOX_MODEL_URL = "/creatures/fox-walk.glb";
const FOX_WALK_CLIP = "Armature|Unreal Take|baselayer";
/** Target wingspan in metres (the file spans ~17.4 units). */
const BIRD_WINGSPAN = 1.05;
/** Rigged bat added to the same flock/sense substrate as the birds. */
const BAT_MODEL_URL = "/creatures/bat_BS_rig.glb";
const BAT_WINGSPAN = 0.7;
const BAT_FLAP_CLIP = "Armature.001Action";
/** Meise (tit): flies at treetop height and below, everywhere. */
const MEISE_MODEL_URL = "/creatures/meise.glb";
const MEISE_WINGSPAN = 0.24;
const MEISE_FLAP_CLIP = "ArmatureAction";
/** Butterfly: flits very low, near flowers and bushes. */
const BUTTERFLY_MODEL_URL = "/creatures/butterfly.glb";
const BUTTERFLY_WINGSPAN = 0.09;
const BUTTERFLY_FLAP_CLIP = "Armature.001Action";

/** What kind of flying animal a flock is made of. */
type FlyingKind = "bird" | "bat" | "meise" | "butterfly";

/** Per-kind flight envelope (metres above ground) + speed band (m/s) + look.
 *  `lift` is the altitude band waypoints are rolled into over the local ground;
 *  `flit` adds erratic vertical wander (butterflies flutter, birds glide);
 *  `attractFlora` biases waypoints toward nearby flowers/bushes. */
interface KindProfile {
  readonly minAlt: number;
  readonly maxAlt: number;
  readonly minSpeed: number;
  readonly maxSpeed: number;
  readonly lift: readonly [number, number];
  readonly flit: number;
  readonly attractFlora: boolean;
  readonly roamScaleKey: "roamScale" | "batRoamScale" | "meiseRoamScale" | "butterflyRoamScale";
  readonly flightSpeedKey:
    | "flightSpeed"
    | "batFlightSpeed"
    | "meiseFlightSpeed"
    | "butterflyFlightSpeed";
}

const KIND_PROFILES: Record<FlyingKind, KindProfile> = {
  bird: {
    minAlt: MIN_ALTITUDE,
    maxAlt: MAX_ALTITUDE,
    minSpeed: MIN_SPEED,
    maxSpeed: MAX_SPEED,
    lift: [18, 43],
    flit: 0,
    attractFlora: false,
    roamScaleKey: "roamScale",
    flightSpeedKey: "flightSpeed",
  },
  bat: {
    minAlt: MIN_ALTITUDE,
    maxAlt: MAX_ALTITUDE,
    minSpeed: MIN_SPEED,
    maxSpeed: MAX_SPEED,
    lift: [18, 43],
    flit: 0,
    attractFlora: false,
    roamScaleKey: "batRoamScale",
    flightSpeedKey: "batFlightSpeed",
  },
  // Meise: treetop height and lower — a low, agile songbird.
  meise: {
    minAlt: 1.5,
    maxAlt: 14,
    minSpeed: 3,
    maxSpeed: 8,
    lift: [2, 11],
    flit: 0.6,
    attractFlora: false,
    roamScaleKey: "meiseRoamScale",
    flightSpeedKey: "meiseFlightSpeed",
  },
  // Butterfly: very low, near flowers/bushes, fluttering.
  butterfly: {
    minAlt: 0.4,
    maxAlt: 2.6,
    minSpeed: 0.8,
    maxSpeed: 2.6,
    lift: [0.5, 2.0],
    flit: 1.8,
    attractFlora: true,
    roamScaleKey: "butterflyRoamScale",
    flightSpeedKey: "butterflyFlightSpeed",
  },
};
const DEER_TARGET_HEIGHT = 1.75;
/** The walking fox stands ~0.55 m at the shoulder — smaller and nimbler than the deer. */
const FOX_TARGET_HEIGHT = 0.55;
const DEER_WAYPOINT_REACHED = 3;
const DEER_WAYPOINT_TIMEOUT = 34;
const DEER_LOOK_AHEAD = 7;
/** Maximum yaw change keeps paths broad and readable instead of twitchy. */
const DEER_MAX_TURN_RATE = 0.22;
/** Movement speed at which the authored walk clip plays at its native tempo. */
const DEER_WALK_REFERENCE_SPEED = 1.4;
/** The fox's own walk clip reference speed (it trots quicker than the deer). */
const FOX_WALK_REFERENCE_SPEED = 1.8;
const MAX_GROUND_SLOPE = 0.65;
const DEER_MIN_PLAYER_DISTANCE = 15;
const DEER_MIN_SPACING = 6;
const FOX_MIN_PLAYER_DISTANCE = 8;
const FOX_MIN_SPACING = 3;
/** Re-scatter the mushrooms when the player is farther than this from their anchor. */
const MUSHROOM_REANCHOR = 110;

export type GroundSource = (x: number, z: number) => number | null;

export interface GroundObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export type GroundObstacleSource = (
  x: number,
  z: number,
  radius: number,
) => readonly GroundObstacle[];

export interface BirdActor {
  /** Root object — what the motion sense samples and the network reads. */
  readonly object: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

export interface Creatures {
  /** Scene parent of all fauna meshes. */
  readonly group: THREE.Group;
  readonly birds: readonly BirdActor[];
  /** Persistent particle mosquitoes, grouped into compact ground-near swarms. */
  readonly mosquitoes: MosquitoFlocks;
  /** Mushroom positions (world space). Mutated on re-anchor; listen for the
   *  `creatures:mushrooms-changed` bus event to rebuild dependents. */
  readonly mushrooms: readonly THREE.Vector3[];
  /** Foot positions (world space) of the roaming ground fauna (deer + foxes) —
   *  the duft sense drops a scent trail along these. */
  groundAnimalPositions(): { x: number; y: number; z: number }[];
  /** Apply the sense visibility gates while simulations continue in the background. */
  setVisibility(birdsVisible: boolean, groundFaunaVisible: boolean): void;
  /** Terrain streaming hooks: ground fauna is scattered and released with chunks. */
  onChunkBuilt(info: ChunkBuiltInfo): void;
  onChunkDisposed(cell: ChunkCell): void;
  /** Apply new fauna config. Behavioural knobs take effect live; count changes
   *  rebuild only the affected fauna set and emit the corresponding bus event. */
  reconfigure(config: FaunaConfig): void;
  /** Concise live state for the browser test/debug bridge. */
  debugSnapshot(): {
    readonly visibility: { readonly birds: boolean; readonly groundFauna: boolean };
    readonly streamedChunks: number;
    readonly mosquitoes: {
      readonly swarms: number;
      readonly particles: number;
      readonly placed: boolean;
    };
    readonly flying: Readonly<
      Record<FlyingKind, { readonly flocks: number; readonly animals: number }>
    >;
    readonly deer: readonly {
      x: number;
      y: number;
      z: number;
      homeX: number;
      homeZ: number;
      placed: boolean;
      treeClearance: number | null;
      animationTime: number;
      heading: number;
      waypointX: number;
      waypointZ: number;
    }[];
    readonly foxes: readonly {
      x: number;
      y: number;
      z: number;
      placed: boolean;
      homeKey: string;
    }[];
  };
  update(dt: number): void;
  dispose(): void;
}

interface Bird extends BirdActor {
  /** Drives the per-bird wander jitter (a stable random phase). */
  readonly flapPhase: number;
  /** The armature's flap-cycle mixer — advanced with the virtual clock. */
  readonly mixer: THREE.AnimationMixer;
  /** Which flock this bird belongs to — neighbours are flock-internal. */
  readonly flock: number;
  readonly kind: FlyingKind;
}

/** One flock's shared state: the wandering goal its members seek. */
interface Flock {
  readonly waypoint: THREE.Vector3;
  readonly kind: FlyingKind;
  readonly ringIndex: number;
  readonly ringCount: number;
  /** Stable member list keeps boids work flock-local as populations grow. */
  readonly members: Bird[];
  /** Seconds since the waypoint was rolled (drives the timeout re-roll). */
  age: number;
}

export interface CreatureSenseOptions {
  /** The live sense uniforms (the same set terrain/flora wear). */
  uniforms?: KitUniforms;
  /** The shader-sense compositor — birds run through the SAME sense layers, so
   *  infrarot reads them as WARM BODIES, echo as depth, uv as faint signal. */
  layers?: FloraLayerCompositor;
  /** Flock / speed / mushroom config. Defaults to `DEFAULT_CONFIG.fauna`. */
  config?: FaunaConfig;
  /** Live tree-trunk query from the flora scatter. */
  groundObstacles?: GroundObstacleSource;
  /** Semantic terrain-water lookup. A terrain height also exists below water,
   *  so fauna placement must reject ocean/lake/river cells explicitly. */
  waterAt?: (x: number, z: number) => boolean;
  /** Nearby flower/bush world positions — butterflies flit toward these. Returns
   *  the (x, z) of blooming flora within `radius`; empty far from any meadow. */
  floraAttractors?: (x: number, z: number, radius: number) => readonly { x: number; z: number }[];
}

export async function createCreatures(
  scene: THREE.Scene,
  bus: Bus,
  ground: GroundSource,
  senseOpts: CreatureSenseOptions = {},
): Promise<Creatures> {
  const group = new THREE.Group();
  group.name = "creatures";
  const birdGroup = new THREE.Group();
  birdGroup.name = "birds";
  birdGroup.visible = false;
  const groundFaunaGroup = new THREE.Group();
  groundFaunaGroup.name = "ground-fauna";
  groundFaunaGroup.visible = false;
  group.add(birdGroup, groundFaunaGroup);
  scene.add(group);

  // ── fauna assets ──
  const loader = new GLTFLoader();
  const [birdGltf, batGltf, meiseGltf, butterflyGltf, deerGltf, foxGltf] = await Promise.all([
    loader.loadAsync(BIRD_MODEL_URL),
    loader.loadAsync(BAT_MODEL_URL),
    loader.loadAsync(MEISE_MODEL_URL),
    loader.loadAsync(BUTTERFLY_MODEL_URL),
    loader.loadAsync(DEER_MODEL_URL),
    loader.loadAsync(FOX_MODEL_URL),
  ]);
  const birdFlapClip = birdGltf.animations[0];
  const batFlapClip =
    THREE.AnimationClip.findByName(batGltf.animations, BAT_FLAP_CLIP) ?? undefined;
  const meiseFlapClip =
    THREE.AnimationClip.findByName(meiseGltf.animations, MEISE_FLAP_CLIP) ??
    meiseGltf.animations[0];
  const butterflyFlapClip =
    THREE.AnimationClip.findByName(butterflyGltf.animations, BUTTERFLY_FLAP_CLIP) ?? undefined;

  interface FlyingAsset {
    readonly scene: THREE.Group;
    readonly flapClip: THREE.AnimationClip | undefined;
    readonly scale: number;
    readonly radius: number;
  }

  const prepareAsset = (
    sceneRoot: THREE.Group,
    flapClip: THREE.AnimationClip | undefined,
    wingspan: number,
  ): FlyingAsset => {
    const bounds = new THREE.Box3().setFromObject(sceneRoot);
    const span = bounds.getSize(new THREE.Vector3()).x;
    const radius = Math.hypot(
      Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
      Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)),
      Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
    );
    const scale = wingspan / Math.max(span, 1e-4);

    // Every mesh part receives the whole actor radius, keeping the thermal
    // centre gradient continuous across skinned/material boundaries.
    sceneRoot.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
      }
    });
    return { scene: sceneRoot, flapClip, scale, radius };
  };

  const birdAsset = prepareAsset(birdGltf.scene, birdFlapClip, BIRD_WINGSPAN);
  const batAsset = prepareAsset(batGltf.scene, batFlapClip, BAT_WINGSPAN);
  const meiseAsset = prepareAsset(meiseGltf.scene, meiseFlapClip, MEISE_WINGSPAN);
  const butterflyAsset = prepareAsset(butterflyGltf.scene, butterflyFlapClip, BUTTERFLY_WINGSPAN);
  const assetForKind: Record<FlyingKind, FlyingAsset> = {
    bird: birdAsset,
    bat: batAsset,
    meise: meiseAsset,
    butterfly: butterflyAsset,
  };

  // All four bird parts sit at the same model origin, but their individual geometry
  // spheres have different radii. modelPosition is therefore already shared; give
  // every part the full-bird radius so modelRadius also describes the whole bird and
  // the screen-space thermal gradient cannot restart at a material/mesh boundary.
  // UNLIT (the scene has no lights — a standard material would render black, see
  // src/life/material.ts), composited through the sense layers like flora: the
  // model's own part colours (plumage, belly, beak) are the `farben` albedo,
  // while `infrarot` reads a warm METABOLIC body temperature (~311 K — near the
  // thermal window's hot end, so living birds glow against ground and sky).
  const materials = new Map<string, { material: THREE.MeshBasicNodeMaterial; rewire(): void }>();
  const materialFor = (
    source: THREE.Material,
    fallbackColor?: THREE.Color,
    /** Ground mammal (deer/fox) → its own Infrarot heat channel, not the bird one. */
    mammal = false,
  ): THREE.MeshBasicNodeMaterial => {
    const color =
      fallbackColor ??
      ("color" in source && source.color instanceof THREE.Color
        ? source.color
        : new THREE.Color(0x8e98a8));
    const sourceMap =
      "map" in source && source.map instanceof THREE.Texture ? source.map : undefined;
    const key = `${source.uuid}:${color.getHexString()}:${mammal ? "m" : "b"}`;
    const cached = materials.get(key);
    if (cached) return cached.material;

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    const thermalVariation = uniform(0).onObjectUpdate(({ object }) => {
      const value: unknown = object?.userData["thermalVariation"];
      return typeof value === "number" ? value : 0;
    });
    const rewire = (): void => {
      const { uniforms: u, layers } = senseOpts;
      const tint = vec3(color.r, color.g, color.b);
      const albedo = sourceMap ? texture(sourceMap, uv()).rgb.mul(tint) : tint;
      let base: Node<"vec3"> | Node<"color"> = albedo;
      if (layers) {
        const facing = normalWorld.dot(vec3(0.4, 0.75, 0.3).normalize()).clamp(0, 1);
        base = layers.buildColorNode({
          albedo,
          tempK: float(310).add(facing.mul(2)),
          uvSignal: float(0.4),
          distance: positionView.z.negate(),
          light: facing.mul(0.65).add(0.35),
          thermalBird: float(mammal ? 0 : 1),
          thermalMammal: float(mammal ? 1 : 0),
          thermalObjectVariation: thermalVariation,
          thermalCenter: modelPosition,
          thermalRadius: modelRadius,
        });
      }
      if (u) {
        const fogged = distanceFog(base, u.fogColor, u.fogNear, u.fogFar);
        base = mix(u.fogColor, fogged, viewReveal(u.viewRadius, u.revealSoftness));
      }
      material.colorNode = base;
      material.needsUpdate = true;
    };
    rewire();
    materials.set(key, { material, rewire });
    return material;
  };
  const unsubscribeLayers = senseOpts.layers?.onStructureChange(() => {
    for (const entry of materials.values()) entry.rewire();
  });

  /** One skinned flying animal with shared sense materials and jittered flap.
   * Birds face file −Z; bats face file +X with +Y as their back/up axis. Both
   * are converted to the boid root's +Z lookAt-forward convention. */
  const buildAnimal = (kind: FlyingKind): { root: THREE.Group; mixer: THREE.AnimationMixer } => {
    const asset = assetForKind[kind];
    const model = cloneSkeleton(asset.scene);
    const thermalVariation = Math.random() * 2 - 1;
    // Bats face file +X (yaw −90°); birds/meise face −Z (yaw 180°); the butterfly
    // plane reads either way, keep it facing −Z like the birds.
    model.rotation.y = kind === "bat" ? -Math.PI / 2 : Math.PI;
    model.scale.setScalar(asset.scale);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const source = Array.isArray(child.material) ? child.material[0] : child.material;
      if (source) child.material = materialFor(source);
      child.userData["thermalVariation"] = thermalVariation;
      child.frustumCulled = false; // skinned bounds drift; the flock streams anyway
    });
    const root = new THREE.Group();
    root.add(model);

    const mixer = new THREE.AnimationMixer(model);
    if (asset.flapClip) {
      const action = mixer.clipAction(asset.flapClip);
      action.play();
      action.time = Math.random() * asset.flapClip.duration;
      action.timeScale = 0.9 + Math.random() * 0.4;
    }
    return { root, mixer };
  };

  const deerSource = deerGltf.scene.getObjectByName("Deer_001_rig");
  const foxSource = foxGltf.scene.getObjectByName("Armature");
  if (!deerSource) throw new Error("[creatures] Deer_001_rig missing from deer_walk.glb");
  if (!foxSource) throw new Error("[creatures] Armature missing from fox-walk.glb");

  interface ModelMetrics {
    readonly baseScale: number;
    readonly groundOffset: number;
  }

  const measureModel = (source: THREE.Object3D, targetHeight: number): ModelMetrics => {
    source.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(source);
    const height = Math.max(bounds.max.y - bounds.min.y, 1e-4);
    const baseScale = targetHeight / height;
    return { baseScale, groundOffset: -bounds.min.y * baseScale };
  };

  const deerMetrics = measureModel(deerSource, DEER_TARGET_HEIGHT);
  const foxMetrics = measureModel(foxSource, FOX_TARGET_HEIGHT);
  const deerWalkClip = deerGltf.animations.find((clip) => clip.name === "Deer_001_walk");
  if (!deerWalkClip) throw new Error("[creatures] Deer_001_walk animation missing");
  const foxWalkClip =
    THREE.AnimationClip.findByName(foxGltf.animations, FOX_WALK_CLIP) ?? foxGltf.animations[0];
  if (!foxWalkClip) throw new Error("[creatures] walk animation missing from fox-walk.glb");

  const applyAnimalMaterials = (
    model: THREE.Object3D,
    fallbackColor?: THREE.Color,
    mammal = false,
  ): void => {
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((source) => materialFor(source, fallbackColor, mammal))
        : materialFor(child.material, fallbackColor, mammal);
      child.frustumCulled = false;
    });
  };

  interface Deer {
    readonly homeKey: string;
    readonly home: THREE.Vector3;
    readonly object: THREE.Group;
    readonly model: THREE.Object3D;
    readonly mixer: THREE.AnimationMixer;
    readonly action: THREE.AnimationAction;
    readonly waypoint: THREE.Vector3;
    readonly heading: THREE.Vector3;
    placed: boolean;
    routeReady: boolean;
    waypointAge: number;
    routeCheckAge: number;
  }

  // The fox is a walker with the same roaming state as the deer (it walks the
  // very same waypoint logic, just faster and with a smaller footprint).
  type Fox = Deer;

  /** Per-species walk tuning resolved from the live config each step. */
  interface WalkerTuning {
    readonly speed: number;
    readonly roamRadius: number;
    readonly clearance: number;
    readonly refSpeed: number;
  }
  const deerTuning = (): WalkerTuning => ({
    speed: Math.max(0, fauna.deerSpeed),
    roamRadius: Math.max(18, fauna.deerRoamRadius),
    clearance: fauna.deerTreeClearance,
    refSpeed: DEER_WALK_REFERENCE_SPEED,
  });
  const foxTuning = (): WalkerTuning => ({
    speed: Math.max(0, fauna.foxSpeed),
    roamRadius: Math.max(14, fauna.foxRoamRadius),
    clearance: fauna.foxTreeClearance,
    refSpeed: FOX_WALK_REFERENCE_SPEED,
  });

  const buildDeer = (homeKey: string, home: THREE.Vector3): Deer => {
    const model = cloneSkeleton(deerSource);
    // The deer mesh already faces the wrapper's +Z travel direction.
    applyAnimalMaterials(model, undefined, true); // deer = warm mammal
    const object = new THREE.Group();
    object.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(deerWalkClip);
    action.play();
    action.time = Math.random() * deerWalkClip.duration;
    return {
      homeKey,
      home: home.clone(),
      object,
      model,
      mixer,
      action,
      waypoint: new THREE.Vector3(),
      heading: new THREE.Vector3(0, 0, 1),
      placed: false,
      routeReady: false,
      waypointAge: 0,
      routeCheckAge: 0,
    };
  };

  const buildFox = (homeKey: string, home: THREE.Vector3): Fox => {
    const model = cloneSkeleton(foxSource);
    applyAnimalMaterials(model, new THREE.Color(0xb85f35), true); // fox = warm mammal
    const object = new THREE.Group();
    object.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(foxWalkClip);
    action.play();
    action.time = Math.random() * foxWalkClip.duration;
    return {
      homeKey,
      home: home.clone(),
      object,
      model,
      mixer,
      action,
      waypoint: new THREE.Vector3(),
      heading: new THREE.Vector3(0, 0, 1),
      placed: false,
      routeReady: false,
      waypointAge: 0,
      routeCheckAge: 0,
    };
  };

  const pose = signals.playerPose.peek();
  const waterAt = (x: number, z: number): boolean => senseOpts.waterAt?.(x, z) ?? false;
  const dryGroundAt = (x: number, z: number): number | null => {
    const y = ground(x, z);
    return y === null || waterAt(x, z) ? null : y;
  };

  // Live fauna config — the update loop reads roam/speed from here; counts drive
  // the flock/mushroom rebuilds in `reconfigure`.
  // Keep a private snapshot: the coordinator mutates its live config object in
  // place, while reconfigure needs the previous values to detect count changes.
  let fauna: FaunaConfig = normalizeFaunaConfig(senseOpts.config ?? DEFAULT_CONFIG.fauna);

  // ── birds ──
  // A flock waypoint: somewhere in the flock's roam ring around the player, at
  // soaring altitude over the local terrain (player height as the fallback
  // while the chunk under it is still streaming).
  const rollDryGroundPoint = (
    target: THREE.Vector3,
    ring: { min: number; max: number },
  ): boolean => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = ring.min + Math.sqrt(Math.random()) * Math.max(0, ring.max - ring.min);
      const x = pose.x + Math.cos(a) * r;
      const z = pose.z + Math.sin(a) * r;
      const y = dryGroundAt(x, z);
      if (y === null) continue;
      target.set(x, y, z);
      return true;
    }
    return false;
  };

  const rollWaypoint = (
    target: THREE.Vector3,
    ring: { min: number; max: number },
    kind: FlyingKind,
  ): boolean => {
    const profile = KIND_PROFILES[kind];
    // Butterflies pick a real flower/bush in the ring when one is nearby, so they
    // congregate over meadows instead of wandering empty ground.
    const attractor = profile.attractFlora ? pickFloraAttractor(ring.max) : null;
    const attractorY = attractor ? dryGroundAt(attractor.x, attractor.z) : null;
    if (attractor && attractorY !== null) {
      target.set(attractor.x, attractorY, attractor.z);
    } else if (!rollDryGroundPoint(target, ring)) {
      return false;
    }
    const [lo, hi] = profile.lift;
    target.y += lo + Math.random() * (hi - lo);
    return true;
  };

  /** A random flowering-flora point within `radius` of the player, or null when
   *  none are streamed in nearby (butterflies then wander a low patch). */
  const pickFloraAttractor = (radius: number): { x: number; z: number } | null => {
    const spots = senseOpts.floraAttractors?.(pose.x, pose.z, radius) ?? [];
    if (spots.length === 0) return null;
    return spots[Math.floor(Math.random() * spots.length)] ?? null;
  };

  const flocks: Flock[] = [];
  // `birds` is mutated IN PLACE across rebuilds so live readers (netzwerk, synth)
  // keep a valid reference; motion caches target objects, so it re-reads on the
  // `creatures:birds-changed` event that `rebuildFlocks` emits.
  const birds: Bird[] = [];
  let flyingPlacementPending = false;

  const randomFlockSize = (rawMin: number, rawMax: number): number => {
    const a = Math.max(1, Math.round(rawMin));
    const b = Math.max(1, Math.round(rawMax));
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  /** Rebuild bird and bat flocks from their mirrored fauna controls. */
  const rebuildFlocks = (emit: boolean): void => {
    for (const b of birds) b.object.removeFromParent();
    birds.length = 0;
    flocks.length = 0;

    const addFlocks = (
      kind: FlyingKind,
      rawCount: number,
      rawMinPerFlock: number,
      rawMaxPerFlock: number,
      roamScale: number,
    ): void => {
      const count = Math.max(0, Math.round(rawCount));
      for (let f = 0; f < count; f++) {
        const perFlock = randomFlockSize(rawMinPerFlock, rawMaxPerFlock);
        const ring = ringFor(f, count, roamScale);
        const start = new THREE.Vector3();
        if (!rollDryGroundPoint(start, ring)) continue;
        const flockIndex = flocks.length;
        const flock: Flock = {
          waypoint: new THREE.Vector3(),
          age: 0,
          kind,
          ringIndex: f,
          ringCount: count,
          members: [],
        };
        if (!rollWaypoint(flock.waypoint, ring, kind)) continue;
        flocks.push(flock);

        // Each flock spawns as a loose, species-pure cloud in its own ring, at
        // the kind's own altitude band over the local ground (low for meise /
        // butterflies, soaring for birds / bats).
        const profile = KIND_PROFILES[kind];
        const cx = start.x;
        const cz = start.z;
        const spread = kind === "butterfly" ? 8 : kind === "meise" ? 16 : 24;
        for (let i = 0; i < perFlock; i++) {
          const { root, mixer } = buildAnimal(kind);
          let sx = cx;
          let sz = cz;
          let sg = start.y;
          for (let attempt = 0; attempt < 12; attempt++) {
            const candidateX = cx + (Math.random() - 0.5) * spread;
            const candidateZ = cz + (Math.random() - 0.5) * spread;
            const candidateY = dryGroundAt(candidateX, candidateZ);
            if (candidateY === null) continue;
            sx = candidateX;
            sz = candidateZ;
            sg = candidateY;
            break;
          }
          root.position.set(
            sx,
            sg + profile.lift[0] + Math.random() * (profile.lift[1] - profile.lift[0]),
            sz,
          );
          birdGroup.add(root);
          const bird: Bird = {
            object: root,
            position: root.position,
            velocity: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)
              .normalize()
              .multiplyScalar(MIN_SPEED + 2),
            flapPhase: Math.random() * Math.PI * 2,
            mixer,
            flock: flockIndex,
            kind,
          };
          birds.push(bird);
          flock.members.push(bird);
        }
      }
    };

    addFlocks(
      "bird",
      fauna.flockCount,
      fauna.birdMinPerFlock,
      fauna.birdMaxPerFlock,
      fauna.roamScale,
    );
    addFlocks(
      "bat",
      fauna.batFlockCount,
      fauna.batMinPerFlock,
      fauna.batMaxPerFlock,
      fauna.batRoamScale,
    );
    addFlocks(
      "meise",
      fauna.meiseFlockCount,
      fauna.meiseMinPerFlock,
      fauna.meiseMaxPerFlock,
      fauna.meiseRoamScale,
    );
    addFlocks(
      "butterfly",
      fauna.butterflyFlockCount,
      fauna.butterflyMinPerFlock,
      fauna.butterflyMaxPerFlock,
      fauna.butterflyRoamScale,
    );
    const requestedFlocks =
      fauna.flockCount + fauna.batFlockCount + fauna.meiseFlockCount + fauna.butterflyFlockCount;
    flyingPlacementPending = requestedFlocks > 0 && flocks.length === 0;
    if (emit) bus.emit("creatures:birds-changed");
  };
  rebuildFlocks(false);

  // Model-free world mosquitoes: compact, ground-near swarms whose anchors
  // remain fixed until the player has travelled far beyond their area.
  const mosquitoes = createMosquitoFlocks(group, ground, waterAt, fauna, senseOpts.layers);

  // ── mushrooms ──
  const mushrooms: THREE.Vector3[] = [];
  let mushroomAnchor: { x: number; z: number } | null = null;

  const scatterMushrooms = (): boolean => {
    const target = Math.max(0, Math.round(fauna.mushroomCount));
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < target * 2 && next.length < target; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.sqrt(Math.random()) * fauna.mushroomRadius;
      const x = pose.x + Math.cos(a) * r;
      const z = pose.z + Math.sin(a) * r;
      const y = dryGroundAt(x, z);
      if (y === null) continue;
      next.push(new THREE.Vector3(x, y + 0.15, z));
    }
    if (target > 0 && next.length < 4) {
      return false; // terrain not streamed yet
    }
    mushrooms.length = 0;
    mushrooms.push(...next);
    mushroomAnchor = { x: pose.x, z: pose.z };
    bus.emit("creatures:mushrooms-changed");
    return true;
  };

  // ── ground fauna ──
  const deers: Deer[] = [];
  const foxes: Fox[] = [];

  const streamedGroundChunks = new Set<string>();
  const groundChunkKey = (gridX: number, gridZ: number): string => `${gridX},${gridZ}`;

  const setAnimalScale = (model: THREE.Object3D, metrics: ModelMetrics, scale: number): void => {
    model.scale.setScalar(metrics.baseScale * scale);
    model.position.y = metrics.groundOffset * scale;
  };

  const slopeAt = (x: number, z: number): number | null => {
    const d = 1.5;
    const left = ground(x - d, z);
    const right = ground(x + d, z);
    const back = ground(x, z - d);
    const front = ground(x, z + d);
    if (left === null || right === null || back === null || front === null) return null;
    return Math.hypot((right - left) / (2 * d), (front - back) / (2 * d));
  };

  const pointIsClear = (x: number, z: number, clearance: number): boolean => {
    if (waterAt(x, z)) return false;
    const obstacles = senseOpts.groundObstacles?.(x, z, clearance) ?? [];
    return obstacles.every((obstacle) => {
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      const reach = clearance + obstacle.radius;
      return dx * dx + dz * dz > reach * reach;
    });
  };

  const routeIsClear = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    clearance: number,
  ): boolean => {
    const sx = toX - fromX;
    const sz = toZ - fromZ;
    const lengthSq = sx * sx + sz * sz;
    const length = Math.sqrt(lengthSq);
    const waterSteps = Math.max(1, Math.ceil(length / 4));
    for (let i = 0; i <= waterSteps; i++) {
      const t = i / waterSteps;
      if (waterAt(fromX + sx * t, fromZ + sz * t)) return false;
    }
    const midX = (fromX + toX) * 0.5;
    const midZ = (fromZ + toZ) * 0.5;
    const obstacles = senseOpts.groundObstacles?.(midX, midZ, length * 0.5 + clearance) ?? [];
    for (const obstacle of obstacles) {
      const t =
        lengthSq > 1e-4
          ? Math.min(
              1,
              Math.max(0, ((obstacle.x - fromX) * sx + (obstacle.z - fromZ) * sz) / lengthSq),
            )
          : 0;
      const dx = obstacle.x - (fromX + sx * t);
      const dz = obstacle.z - (fromZ + sz * t);
      const reach = clearance + obstacle.radius;
      if (dx * dx + dz * dz <= reach * reach) return false;
    }
    return true;
  };

  // Ground fauna are land animals: they never spawn on, nor walk into, water.
  // Best-effort — `waterAt` reports false for terrain that isn't streamed yet.
  const isWaterAt = senseOpts.waterAt;
  const pointIsDry = (x: number, z: number): boolean => !isWaterAt || !isWaterAt(x, z);
  /** True if the straight segment from→to stays out of water (sampled every ~4 m). */
  const routeAvoidsWater = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): boolean => {
    if (!isWaterAt) return true;
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const steps = Math.max(1, Math.ceil(length / 4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (isWaterAt(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) return false;
    }
    return true;
  };

  const findOpenPoint = (
    target: THREE.Vector3,
    minRadius: number,
    maxRadius: number,
    clearance: number,
    routeFrom?: THREE.Vector3,
    centrePoint: { readonly x: number; readonly z: number } = pose,
  ): boolean => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = minRadius + Math.sqrt(Math.random()) * Math.max(0, maxRadius - minRadius);
      const x = centrePoint.x + Math.cos(angle) * radius;
      const z = centrePoint.z + Math.sin(angle) * radius;
      const y = ground(x, z);
      const slope = slopeAt(x, z);
      if (y === null || slope === null || slope > MAX_GROUND_SLOPE) continue;
      if (!pointIsDry(x, z)) continue;
      if (!pointIsClear(x, z, clearance)) continue;
      if (routeFrom && !routeIsClear(routeFrom.x, routeFrom.z, x, z, clearance)) continue;
      if (routeFrom && !routeAvoidsWater(routeFrom.x, routeFrom.z, x, z)) continue;
      target.set(x, y, z);
      return true;
    }
    return false;
  };

  const rollWalkerWaypoint = (walker: Deer, tuning: WalkerTuning): boolean => {
    const found = findOpenPoint(
      walker.waypoint,
      12,
      tuning.roamRadius,
      tuning.clearance,
      walker.object.position,
      walker.home,
    );
    if (found && !walker.routeReady) {
      const dx = walker.waypoint.x - walker.object.position.x;
      const dz = walker.waypoint.z - walker.object.position.z;
      const length = Math.hypot(dx, dz) || 1;
      walker.heading.set(dx / length, 0, dz / length);
      walker.object.rotation.y = Math.atan2(walker.heading.x, walker.heading.z);
      walker.routeReady = true;
    }
    walker.waypointAge = found ? 0 : DEER_WAYPOINT_TIMEOUT;
    walker.routeCheckAge = 0;
    return found;
  };

  let deerSerial = 0;
  const reconcileDeer = (emit: boolean): void => {
    const target = Math.max(0, Math.round(fauna.deerCount));
    const radius = Math.max(DEER_MIN_PLAYER_DISTANCE + 1, fauna.deerRoamRadius);
    const retainRadiusSq = (radius + 40) ** 2;
    let changed = false;
    for (let i = deers.length - 1; i >= 0; i--) {
      const deer = deers[i];
      const dx = deer ? deer.object.position.x - pose.x : 0;
      const dz = deer ? deer.object.position.z - pose.z : 0;
      if (
        deer &&
        i < target &&
        dx * dx + dz * dz <= retainRadiusSq &&
        ground(deer.object.position.x, deer.object.position.z) !== null &&
        !waterAt(deer.object.position.x, deer.object.position.z)
      ) {
        continue;
      }
      if (!deer) continue;
      deer.object.removeFromParent();
      deers.splice(i, 1);
      changed = true;
    }

    const candidate = new THREE.Vector3();
    const maxAttempts = Math.max(32, (target - deers.length) * 12);
    for (let attempt = 0; deers.length < target && attempt < maxAttempts; attempt++) {
      if (!findOpenPoint(candidate, DEER_MIN_PLAYER_DISTANCE, radius, fauna.deerTreeClearance)) {
        continue;
      }
      const spaced = deers.every(
        (deer) => deer.object.position.distanceTo(candidate) >= DEER_MIN_SPACING,
      );
      if (!spaced) continue;

      const deer = buildDeer(`deer:${deerSerial++}`, candidate);
      setAnimalScale(deer.model, deerMetrics, fauna.deerScale);
      deer.object.position.copy(candidate);
      const yaw = Math.random() * Math.PI * 2;
      deer.heading.set(Math.sin(yaw), 0, Math.cos(yaw));
      deer.object.rotation.y = yaw;
      deer.object.visible = true;
      deer.placed = true;
      deer.waypointAge = DEER_WAYPOINT_TIMEOUT;
      groundFaunaGroup.add(deer.object);
      deers.push(deer);
      changed = true;
    }
    if (emit && changed) bus.emit("creatures:ground-fauna-changed");
  };

  let foxSerial = 0;
  const reconcileFoxes = (emit: boolean): void => {
    const target = Math.max(0, Math.round(fauna.foxCount));
    const radius = Math.max(FOX_MIN_PLAYER_DISTANCE + 1, fauna.foxRoamRadius);
    const retainRadiusSq = (radius + 30) ** 2;
    let changed = false;
    for (let i = foxes.length - 1; i >= 0; i--) {
      const fox = foxes[i];
      const dx = fox ? fox.object.position.x - pose.x : 0;
      const dz = fox ? fox.object.position.z - pose.z : 0;
      if (
        fox &&
        i < target &&
        dx * dx + dz * dz <= retainRadiusSq &&
        ground(fox.object.position.x, fox.object.position.z) !== null &&
        !waterAt(fox.object.position.x, fox.object.position.z)
      ) {
        continue;
      }
      if (!fox) continue;
      fox.object.removeFromParent();
      foxes.splice(i, 1);
      changed = true;
    }
    const candidate = new THREE.Vector3();
    const maxAttempts = Math.max(32, (target - foxes.length) * 12);
    for (let attempt = 0; foxes.length < target && attempt < maxAttempts; attempt++) {
      if (!findOpenPoint(candidate, FOX_MIN_PLAYER_DISTANCE, radius, fauna.foxTreeClearance)) {
        continue;
      }
      const spaced = foxes.every(
        (fox) => fox.object.position.distanceTo(candidate) >= FOX_MIN_SPACING,
      );
      if (!spaced) continue;

      const fox = buildFox(`fox:${foxSerial++}`, candidate);
      setAnimalScale(fox.model, foxMetrics, fauna.foxScale);
      fox.object.position.copy(candidate);
      const yaw = Math.random() * Math.PI * 2;
      fox.heading.set(Math.sin(yaw), 0, Math.cos(yaw));
      fox.object.rotation.y = yaw;
      fox.object.visible = true;
      fox.placed = true;
      fox.waypointAge = DEER_WAYPOINT_TIMEOUT;
      groundFaunaGroup.add(fox.object);
      foxes.push(fox);
      changed = true;
    }
    if (emit && changed) bus.emit("creatures:ground-fauna-changed");
  };

  // Scratch vectors (no per-frame allocation).
  const centre = new THREE.Vector3();
  const steer = new THREE.Vector3();
  const diff = new THREE.Vector3();
  const align = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const avoid = new THREE.Vector3();

  let elapsed = 0;
  let localFaunaReconcileAge = 0;

  return {
    group,
    birds,
    mosquitoes,
    mushrooms,
    setVisibility(birdsVisible: boolean, groundFaunaVisible: boolean): void {
      // Simulations keep advancing while hidden, so perception modules continue
      // reading live positions and animation.
      birdGroup.visible = birdsVisible;
      groundFaunaGroup.visible = groundFaunaVisible;
    },
    onChunkBuilt(info: ChunkBuiltInfo): void {
      streamedGroundChunks.add(groundChunkKey(info.gridX, info.gridZ));
      // Creature creation precedes terrain streaming. If no dry spawn point was
      // available at boot, retry once real land fields arrive rather than using
      // the old underwater/unknown-ground fallback.
      if (flyingPlacementPending) rebuildFlocks(true);
      reconcileDeer(true);
      reconcileFoxes(true);
    },
    onChunkDisposed(cell: ChunkCell): void {
      streamedGroundChunks.delete(groundChunkKey(cell.gridX, cell.gridZ));
      reconcileDeer(true);
      reconcileFoxes(true);
    },
    reconfigure(next: FaunaConfig): void {
      const normalized = normalizeFaunaConfig(next);
      const birdCountsChanged =
        normalized.flockCount !== fauna.flockCount ||
        normalized.birdMinPerFlock !== fauna.birdMinPerFlock ||
        normalized.birdMaxPerFlock !== fauna.birdMaxPerFlock ||
        normalized.batFlockCount !== fauna.batFlockCount ||
        normalized.batMinPerFlock !== fauna.batMinPerFlock ||
        normalized.batMaxPerFlock !== fauna.batMaxPerFlock ||
        normalized.meiseFlockCount !== fauna.meiseFlockCount ||
        normalized.meiseMinPerFlock !== fauna.meiseMinPerFlock ||
        normalized.meiseMaxPerFlock !== fauna.meiseMaxPerFlock ||
        normalized.butterflyFlockCount !== fauna.butterflyFlockCount ||
        normalized.butterflyMinPerFlock !== fauna.butterflyMinPerFlock ||
        normalized.butterflyMaxPerFlock !== fauna.butterflyMaxPerFlock;
      const mushroomsChanged =
        normalized.mushroomCount !== fauna.mushroomCount ||
        normalized.mushroomRadius !== fauna.mushroomRadius;
      const deerCountChanged = normalized.deerCount !== fauna.deerCount;
      const deerRouteChanged = normalized.deerRoamRadius !== fauna.deerRoamRadius;
      const deerAnchorsChanged = normalized.deerTreeClearance !== fauna.deerTreeClearance;
      const foxCountChanged = normalized.foxCount !== fauna.foxCount;
      const foxRouteChanged = normalized.foxRoamRadius !== fauna.foxRoamRadius;
      const foxAnchorsChanged = normalized.foxTreeClearance !== fauna.foxTreeClearance;
      mosquitoes.reconfigure(normalized);
      fauna = structuredClone(normalized);
      // roam/speed are read live in `update` — nothing to do for those.
      if (birdCountsChanged) rebuildFlocks(true); // emits creatures:birds-changed
      if (mushroomsChanged) scatterMushrooms(); // emits creatures:mushrooms-changed
      if (deerAnchorsChanged) {
        for (const deer of deers) deer.object.removeFromParent();
        deers.length = 0;
        reconcileDeer(true);
      } else if (deerCountChanged) {
        reconcileDeer(true);
      } else {
        for (const deer of deers) {
          setAnimalScale(deer.model, deerMetrics, fauna.deerScale);
          if (deerRouteChanged) deer.waypointAge = DEER_WAYPOINT_TIMEOUT;
        }
        if (deerRouteChanged) reconcileDeer(true);
      }
      if (foxAnchorsChanged) {
        for (const fox of foxes) fox.object.removeFromParent();
        foxes.length = 0;
        reconcileFoxes(true);
      } else if (foxCountChanged) {
        reconcileFoxes(true);
      } else {
        for (const fox of foxes) {
          setAnimalScale(fox.model, foxMetrics, fauna.foxScale);
          if (foxRouteChanged) fox.waypointAge = DEER_WAYPOINT_TIMEOUT;
        }
        if (foxRouteChanged) reconcileFoxes(true);
      }
    },
    groundAnimalPositions(): { x: number; y: number; z: number }[] {
      const out: { x: number; y: number; z: number }[] = [];
      for (const deer of deers) {
        if (deer.placed) {
          out.push({
            x: deer.object.position.x,
            y: deer.object.position.y,
            z: deer.object.position.z,
          });
        }
      }
      for (const fox of foxes) {
        if (fox.placed) {
          out.push({
            x: fox.object.position.x,
            y: fox.object.position.y,
            z: fox.object.position.z,
          });
        }
      }
      return out;
    },
    debugSnapshot() {
      const flying = {
        bird: { flocks: 0, animals: 0 },
        bat: { flocks: 0, animals: 0 },
        meise: { flocks: 0, animals: 0 },
        butterfly: { flocks: 0, animals: 0 },
      } satisfies Record<FlyingKind, { flocks: number; animals: number }>;
      for (const flock of flocks) {
        flying[flock.kind].flocks++;
        flying[flock.kind].animals += flock.members.length;
      }
      return {
        visibility: { birds: birdGroup.visible, groundFauna: groundFaunaGroup.visible },
        streamedChunks: streamedGroundChunks.size,
        mosquitoes: {
          swarms: mosquitoes.swarmCount,
          particles: mosquitoes.count,
          placed: mosquitoes.placed,
        },
        flying,
        deer: deers.map((deer) => {
          const nearby =
            senseOpts.groundObstacles?.(
              deer.object.position.x,
              deer.object.position.z,
              fauna.deerTreeClearance + 8,
            ) ?? [];
          const treeClearance = nearby.reduce(
            (nearest, obstacle) =>
              Math.min(
                nearest,
                Math.hypot(
                  deer.object.position.x - obstacle.x,
                  deer.object.position.z - obstacle.z,
                ) - obstacle.radius,
              ),
            Number.POSITIVE_INFINITY,
          );
          return {
            x: deer.object.position.x,
            y: deer.object.position.y,
            z: deer.object.position.z,
            homeX: deer.home.x,
            homeZ: deer.home.z,
            placed: deer.placed,
            treeClearance: Number.isFinite(treeClearance) ? treeClearance : null,
            animationTime: deer.action.time,
            heading: Math.atan2(deer.heading.x, deer.heading.z),
            waypointX: deer.waypoint.x,
            waypointZ: deer.waypoint.z,
          };
        }),
        foxes: foxes.map((fox) => ({
          x: fox.object.position.x,
          y: fox.object.position.y,
          z: fox.object.position.z,
          placed: fox.placed,
          homeKey: fox.homeKey,
        })),
      };
    },
    update(dt: number): void {
      if (dt <= 0) {
        return;
      }
      elapsed += dt;
      mosquitoes.update(dt);
      localFaunaReconcileAge += dt;
      if (localFaunaReconcileAge >= 2) {
        localFaunaReconcileAge = 0;
        reconcileDeer(true);
        reconcileFoxes(true);
      }

      // Mushrooms: initial scatter + re-anchor when the player flew on.
      if (!mushroomAnchor) {
        scatterMushrooms();
      } else {
        const dx = pose.x - mushroomAnchor.x;
        const dz = pose.z - mushroomAnchor.z;
        if (dx * dx + dz * dz > MUSHROOM_REANCHOR * MUSHROOM_REANCHOR) {
          scatterMushrooms();
        }
      }

      // Deer and foxes both walk tree-free line segments through the actual
      // streamed flora, on identical waypoint logic (see stepWalker); only their
      // speed / roam radius / clearance / clip tempo differ (their WalkerTuning).
      // A short look-ahead repulsion handles trunks near bends or newly re-scattered
      // trees without snapping the animal to a new position.
      const stepWalker = (w: Deer, tuning: WalkerTuning): void => {
        w.waypointAge += dt;
        w.routeCheckAge += dt;
        diff.copy(w.waypoint).sub(w.object.position);
        diff.y = 0;
        let targetDistance = diff.length();
        const needsWaypoint =
          targetDistance < DEER_WAYPOINT_REACHED || w.waypointAge >= DEER_WAYPOINT_TIMEOUT;
        const routeBlocked =
          w.routeCheckAge >= 1.25 &&
          (!routeIsClear(
            w.object.position.x,
            w.object.position.z,
            w.waypoint.x,
            w.waypoint.z,
            tuning.clearance,
          ) ||
            !routeAvoidsWater(
              w.object.position.x,
              w.object.position.z,
              w.waypoint.x,
              w.waypoint.z,
            ));
        if (needsWaypoint || routeBlocked) {
          if (!rollWalkerWaypoint(w, tuning)) {
            w.action.timeScale = 0;
            return;
          }
          diff.copy(w.waypoint).sub(w.object.position);
          diff.y = 0;
          targetDistance = diff.length();
        } else if (w.routeCheckAge >= 1.25) {
          w.routeCheckAge = 0;
        }

        if (targetDistance < 1e-3) {
          w.action.timeScale = 0;
          return;
        }
        desired.copy(diff).divideScalar(targetDistance);
        avoid.set(0, 0, 0);
        const lookX = w.object.position.x + desired.x * DEER_LOOK_AHEAD;
        const lookZ = w.object.position.z + desired.z * DEER_LOOK_AHEAD;
        const nearby =
          senseOpts.groundObstacles?.(
            (w.object.position.x + lookX) * 0.5,
            (w.object.position.z + lookZ) * 0.5,
            DEER_LOOK_AHEAD + tuning.clearance,
          ) ?? [];
        for (const obstacle of nearby) {
          const awayX = w.object.position.x - obstacle.x;
          const awayZ = w.object.position.z - obstacle.z;
          const distance = Math.hypot(awayX, awayZ);
          const influence = obstacle.radius + tuning.clearance + DEER_LOOK_AHEAD;
          if (distance >= influence) continue;
          const strength = (influence - distance) / influence;
          if (distance > 1e-3) {
            avoid.x += (awayX / distance) * strength;
            avoid.z += (awayZ / distance) * strength;
          } else {
            avoid.x += -desired.z;
            avoid.z += desired.x;
          }
        }

        steer.copy(desired).addScaledVector(avoid, 1.8);
        if (steer.lengthSq() < 1e-4) steer.copy(desired);
        steer.normalize();
        const currentYaw = Math.atan2(w.heading.x, w.heading.z);
        const targetYaw = Math.atan2(steer.x, steer.z);
        const yawDelta = Math.atan2(
          Math.sin(targetYaw - currentYaw),
          Math.cos(targetYaw - currentYaw),
        );
        const maxYawStep = DEER_MAX_TURN_RATE * dt;
        const yaw = currentYaw + Math.min(maxYawStep, Math.max(-maxYawStep, yawDelta));
        w.heading.set(Math.sin(yaw), 0, Math.cos(yaw));

        const speed = tuning.speed;
        const step = speed * dt;
        const nextX = w.object.position.x + w.heading.x * step;
        const nextZ = w.object.position.z + w.heading.z * step;
        const nextY = ground(nextX, nextZ);
        const stepIsClear = pointIsClear(nextX, nextZ, tuning.clearance);
        if (
          nextY === null ||
          !stepIsClear ||
          Math.abs(nextY - w.object.position.y) > Math.max(0.5, step * MAX_GROUND_SLOPE)
        ) {
          w.waypointAge = DEER_WAYPOINT_TIMEOUT;
          w.action.timeScale = 0;
          return;
        }

        w.object.position.set(nextX, nextY, nextZ);
        w.object.rotation.y = yaw;
        w.action.timeScale = speed / tuning.refSpeed;
        w.mixer.update(dt);
      };

      const deerWalk = deerTuning();
      for (const deer of deers) stepWalker(deer, deerWalk);
      const foxWalk = foxTuning();
      for (const fox of foxes) stepWalker(fox, foxWalk);

      // ── Flock goals: reached / stale / left-behind waypoints get re-rolled ──
      for (const flock of flocks) {
        const roamScale = fauna[KIND_PROFILES[flock.kind].roamScaleKey];
        const ring = ringFor(flock.ringIndex, flock.ringCount, roamScale);
        flock.age += dt;

        centre.set(0, 0, 0);
        let flockSize = 0;
        for (const b of flock.members) {
          centre.add(b.position);
          flockSize++;
        }
        centre.divideScalar(Math.max(1, flockSize));

        const centroidDx = centre.x - pose.x;
        const centroidDz = centre.z - pose.z;
        const reanchorRadius = ring.max + BOUNDARY_MARGIN * 2;
        if (centroidDx * centroidDx + centroidDz * centroidDz > reanchorRadius * reanchorRadius) {
          const target = new THREE.Vector3();
          if (!rollDryGroundPoint(target, ring)) continue;
          const targetX = target.x;
          const targetZ = target.z;
          const targetY = target.y + MIN_ALTITUDE + 10 + Math.random() * 25;
          const offsetX = targetX - centre.x;
          const offsetY = targetY - centre.y;
          const offsetZ = targetZ - centre.z;
          for (const bird of flock.members) {
            bird.position.x += offsetX;
            bird.position.y += offsetY;
            bird.position.z += offsetZ;
          }
          centre.set(targetX, targetY, targetZ);
          rollWaypoint(flock.waypoint, ring, flock.kind);
          flock.age = 0;
        }

        const reached = centre.distanceTo(flock.waypoint) < WAYPOINT_REACHED;
        const behind =
          (flock.waypoint.x - pose.x) ** 2 + (flock.waypoint.z - pose.z) ** 2 >
          (ring.max + 120) ** 2; // the player flew on — bring the route with them
        if (reached || behind || flock.age > WAYPOINT_TIMEOUT) {
          rollWaypoint(flock.waypoint, ring, flock.kind);
          flock.age = 0;
        }
      }

      for (const b of birds) {
        const flock = flocks[b.flock];
        if (!flock) continue;
        const profile = KIND_PROFILES[b.kind];
        const speedScale = fauna[profile.flightSpeedKey];
        const minSpeed = profile.minSpeed * speedScale;
        const maxSpeed = profile.maxSpeed * speedScale;
        steer.set(0, 0, 0);

        // The three Reynolds rules against FLOCKmates (juanuys/boids ranges,
        // scaled to metres): separation < alignment < cohesion radius.
        centre.set(0, 0, 0);
        align.set(0, 0, 0);
        let cohesionCount = 0;
        let alignCount = 0;
        for (const o of flock.members) {
          if (o === b) {
            continue;
          }
          diff.copy(b.position).sub(o.position);
          const d2 = diff.lengthSq();
          if (d2 < SEPARATION_RADIUS * SEPARATION_RADIUS && d2 > 0.0001) {
            steer.addScaledVector(diff, 10 / d2); // separation (inverse-square)
          }
          if (d2 < ALIGNMENT_RADIUS * ALIGNMENT_RADIUS) {
            align.add(o.velocity);
            alignCount++;
          }
          if (d2 < COHESION_RADIUS * COHESION_RADIUS) {
            centre.add(o.position);
            cohesionCount++;
          }
        }
        if (alignCount > 0) {
          align.divideScalar(alignCount).sub(b.velocity);
          steer.addScaledVector(align, 0.5); // match neighbours' heading
        }
        if (cohesionCount > 0) {
          centre.divideScalar(cohesionCount).sub(b.position);
          steer.addScaledVector(centre, 0.25); // toward local centre of mass
        }

        // Migratory urge: seek the flock's wandering waypoint.
        diff.copy(flock.waypoint).sub(b.position);
        const goalDist = diff.length();
        if (goalDist > 1) {
          steer.addScaledVector(diff.divideScalar(goalDist), SEEK_WEIGHT * maxSpeed * 0.35);
        }

        // Boundary (juanuys: outside the sphere the return urge dominates).
        const roamScale = fauna[profile.roamScaleKey];
        const boundary = ringFor(flock.ringIndex, flock.ringCount, roamScale).max + BOUNDARY_MARGIN;
        diff.set(pose.x - b.position.x, 0, pose.z - b.position.z);
        const fromPlayer = diff.length();
        if (fromPlayer > boundary) {
          steer.addScaledVector(diff.normalize(), (fromPlayer - boundary) * 0.5);
        }

        // Terrain floor + altitude ceiling — each kind keeps its own band, so
        // meise hug the treetops and butterflies stay a flower's height up.
        const g = ground(b.position.x, b.position.z);
        if (g !== null) {
          const alt = b.position.y - g;
          if (alt < profile.minAlt) {
            steer.y += (profile.minAlt - alt) * 2.5;
          } else if (alt > profile.maxAlt) {
            steer.y -= (alt - profile.maxAlt) * 0.6;
          }
        }

        // Gentle wander so the flock never fully settles (juanuys wanderWeight 0.2).
        steer.x += Math.sin(elapsed * 0.7 + b.flapPhase * 3.1) * 0.8;
        steer.z += Math.cos(elapsed * 0.6 + b.flapPhase * 2.3) * 0.8;
        // Erratic vertical flit — pronounced for butterflies, off for gliders.
        if (profile.flit > 0) {
          steer.y += Math.sin(elapsed * 4.3 + b.flapPhase * 5.7) * profile.flit;
        }

        // Acceleration clamp, then integrate with min/max speed.
        const force = steer.length();
        if (force > MAX_FORCE) {
          steer.multiplyScalar(MAX_FORCE / force);
        }
        b.velocity.addScaledVector(steer, dt);
        const speed = b.velocity.length();
        const clamped = Math.min(Math.max(speed, minSpeed), maxSpeed);
        if (speed > 0.001) {
          b.velocity.multiplyScalar(clamped / speed);
        }
        b.position.addScaledVector(b.velocity, dt);

        // Orient along the velocity; bank slightly into turns.
        b.object.lookAt(
          b.position.x + b.velocity.x,
          b.position.y + b.velocity.y,
          b.position.z + b.velocity.z,
        );

        // Wing flap — the armature clip is the local vertex motion the motion
        // sense perceives (jittered phase/tempo per bird, set at build).
        b.mixer.update(dt);
      }
    },
    dispose(): void {
      unsubscribeLayers?.();
      mosquitoes.dispose();
      group.removeFromParent();
      for (const entry of materials.values()) entry.material.dispose();
      materials.clear();
      // Skeleton clones share source geometry and textures; dispose each resource once.
      const geometries = new Set<THREE.BufferGeometry>();
      const sourceMaterials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      for (const asset of [birdGltf, batGltf, deerGltf, foxGltf]) {
        asset.scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          geometries.add(child.geometry);
          const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of meshMaterials) {
            sourceMaterials.add(material);
            if ("map" in material && material.map instanceof THREE.Texture) {
              textures.add(material.map);
            }
          }
        });
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of sourceMaterials) material.dispose();
      for (const sourceTexture of textures) sourceTexture.dispose();
    },
  };
}
