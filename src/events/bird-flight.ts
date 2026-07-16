// ── Becoming Many — BirdFlight: a scripted route flight ─────────
//
// TypeScript port of the standalone `bird_intro` prototype (BirdIntro.js).
// One instance = one authored route + one dedicated bird model. `play()`
// re-anchors the route at the presenting camera's pose (via the injected
// {@link AnchorPose}), `update(dt)` advances the flight with the virtual-clock
// delta (so pause/timeScale govern it), and after the authored route ends the
// bird leaves on a procedural outward exit curve and hides itself.
//
// The route comes from an authored animation file (Blender export of an Empty
// with a position track): the first clip with a `.position` track drives the
// flight; clip-less exports fall back to sampling raw curve/mesh points. Both
// FBX and GLB load (header sniff — the authoring pipeline exports FBX today,
// a GLB route would just work).
//
// The core math — time-warped track sampling, the stable forward-facing basis,
// the end-direction lock, the CatmullRom exit — is carried over from the
// prototype unchanged. Host-specific changes: the bird model is injected
// (`getBirdModel`, a dedicated instance we may parent/scale/wrap), the camera
// pose is injected (VR-correct anchoring), and the internal THREE.Clock is
// gone (the host owns time).

import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import type { AnchorPose, EventGroundSource } from "./types.ts";

/** A bird model handed over by the host — a dedicated instance for this event. */
export interface LoadedBirdModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  cleanup?: () => void;
}

export interface BirdFlightOptions {
  /** Provide the bird (dedicated instance — it gets parented and wrapped). */
  getBirdModel: () => Promise<LoadedBirdModel>;
  /** Presenting-camera pose provider — the route anchors here on `play()`. */
  anchor: AnchorPose;
  /** Optional world-position source followed every frame. When present, only
   * XYZ is copied; its rotation and the camera pose are ignored. */
  positionSource?: THREE.Object3D | undefined;
  /** Capture the presenting view's horizontal heading on play while still
   * taking translation exclusively from positionSource. */
  alignToAnchorHeading?: boolean;
  /** Optional terrain query used to lift path samples that would be underground. */
  ground?: EventGroundSource | undefined;
  /** Minimum actor-origin height above terrain when ground is supplied. */
  groundClearance?: number;
  /** Where the flight root lives; defaults to the scene. Pass the player rig
   *  so the route travels with the gliding player (see EventContext.parent). */
  parent?: THREE.Object3D | undefined;
  /** Authored route file (FBX or GLB). Omit to use the built-in fallback arc. */
  pathUrl?: string;
  /** Seconds the authored route is stretched/compressed to. */
  routeDuration?: number;
  /** Optional entry flight before the authored route. The supplied local-space
   *  points start behind/around the camera; BirdFlight adds a tangent-matched
   *  hand-off point and the authored route start automatically. */
  approachDuration?: number;
  approachPoints?: readonly THREE.Vector3[];
  /** Seconds of the outward exit flight after the route ends. */
  exitDuration?: number;
  /** Authored route units → metres. */
  routeScale?: number;
  /** Fixed rotation applied to route deltas before routeStart is added. */
  routeRotation?: THREE.Quaternion;
  /** Route origin in the camera-anchored frame (route start sits here). */
  routeStart?: THREE.Vector3;
  /** Uniform model scale. Omit to keep the scale `getBirdModel` returned. */
  scale?: number;
  /** The model's forward axis in its own space (bird_erasmus faces −Z). */
  modelForward?: THREE.Vector3;
  /** Fine-tune rotations applied to the visual wrapper. */
  modelYawOffset?: number;
  modelZOffset?: number;
  modelRollOffset?: number;
  /** Wing-flap clip name; falls back to the model's first clip. */
  flapClipName?: string;
  flapTimeScale?: number;
  /** Fly the authored route backwards. */
  introReverse?: boolean;
  /** Show the route as an orange debug line (tuning aid). */
  debugRoute?: boolean;
}

const DEFAULTS = {
  pathUrl: undefined as string | undefined,
  routeDuration: 9,
  approachDuration: 0,
  exitDuration: 4.8,
  routeScale: 0.0015,
  scale: undefined as number | undefined,
  modelYawOffset: 0,
  modelZOffset: 0,
  modelRollOffset: -Math.PI / 2,
  flapClipName: "ArmatureAction",
  flapTimeScale: 1,
  introReverse: false,
  debugRoute: false,
  alignToAnchorHeading: false,
  groundClearance: 0,
};

/** The route frame sits slightly in front of the eye, along the camera's view. */
const CAMERA_FORWARD_OFFSET = new THREE.Vector3(0, 0, -0.1);
/** Hide the bird a touch before the exit curve's end (it has left the frame). */
const EXIT_HIDE_PROGRESS = 0.94;
/** Freeze the flight direction over the route's last moments (stable hand-off
 *  into the exit curve — the authored track can wiggle at its very end). */
const END_DIRECTION_LOCK_SECONDS = 0.45;
/** Time used to ease approach rotation and speed into the authored route. */
const APPROACH_HANDOFF_BLEND_SECONDS = 2.4;

/** An authored position(+quaternion) clip, resampled in route space. */
interface AnimatedRoute {
  positionTrack: THREE.KeyframeTrack;
  start: THREE.Vector3;
  sourceDuration: number;
  endDirection: THREE.Vector3;
}

export class BirdFlight {
  private readonly scene: THREE.Scene;
  private readonly options: {
    getBirdModel: () => Promise<LoadedBirdModel>;
    anchor: AnchorPose;
    positionSource: THREE.Object3D | undefined;
    alignToAnchorHeading: boolean;
    ground: EventGroundSource | undefined;
    groundClearance: number;
    pathUrl: string | undefined;
    routeDuration: number;
    approachDuration: number;
    approachPoints: THREE.Vector3[];
    exitDuration: number;
    routeScale: number;
    routeRotation: THREE.Quaternion;
    routeStart: THREE.Vector3;
    scale: number | undefined;
    modelForward: THREE.Vector3;
    modelYawOffset: number;
    modelZOffset: number;
    modelRollOffset: number;
    flapClipName: string;
    flapTimeScale: number;
    introReverse: boolean;
    debugRoute: boolean;
  };

  private readonly root = new THREE.Group();
  private readonly fileLoader = new THREE.FileLoader();
  private readonly fbxLoader = new FBXLoader();
  private readonly gltfLoader = new GLTFLoader();

  private mixer: THREE.AnimationMixer | null = null;
  private wingAction: THREE.AnimationAction | null = null;
  private modelScene: THREE.Object3D | null = null;
  private carrier: THREE.Object3D | null = null;
  private routeLine: THREE.Line | null = null;
  private modelCleanup: (() => void) | null = null;

  private introPath: THREE.Vector3[] | null = null;
  private introTimes: number[] = [];
  private introDuration = 0;
  private introDistance = 0;
  private animatedRoute: AnimatedRoute | null = null;
  private approachCurve: THREE.CatmullRomCurve3 | null = null;
  private routeHandoffQuaternion: THREE.Quaternion | null = null;

  private exitStarted = false;
  private exitCurve: THREE.CatmullRomCurve3 | null = null;
  private elapsed = 0;
  private isPlaying = false;
  private isFinished = false;

  private readonly _scratchPosition = new THREE.Vector3();
  private readonly _scratchLookAt = new THREE.Vector3();
  private readonly _scratchQuaternion = new THREE.Quaternion();
  private readonly _scratchParentQuaternion = new THREE.Quaternion();
  private readonly _scratchDirection = new THREE.Vector3();
  private readonly _scratchRight = new THREE.Vector3();
  private readonly _scratchUp = new THREE.Vector3();
  private readonly _scratchBinormal = new THREE.Vector3();
  private readonly _scratchMatrix = new THREE.Matrix4();
  private readonly _scratchWorldPosition = new THREE.Vector3();
  private readonly _positionSourceQuaternion = new THREE.Quaternion();

  constructor(scene: THREE.Scene, options: BirdFlightOptions) {
    this.scene = scene;
    this.options = {
      ...DEFAULTS,
      ...options,
      positionSource: options.positionSource,
      ground: options.ground,
      approachPoints: (options.approachPoints ?? []).map((point) => point.clone()),
      routeStart: (options.routeStart ?? new THREE.Vector3(-6.6, 0.72, -7.2)).clone(),
      routeRotation: options.routeRotation?.clone() ?? new THREE.Quaternion(),
      modelForward: (options.modelForward ?? new THREE.Vector3(1, 0, 0)).clone(),
    };
    this.fileLoader.setResponseType("arraybuffer");
    this.root.name = "event-bird-flight";
    this.root.visible = false;
    (options.parent ?? this.scene).add(this.root);
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get finished(): boolean {
    return this.isFinished;
  }

  async load(): Promise<void> {
    const loaded = await this.options.getBirdModel();
    if (this.options.pathUrl) {
      const source = await this.loadModel(this.options.pathUrl);
      this.createIntroPathFromSource(source);
    }

    this.modelScene = loaded.scene;
    this.modelCleanup = loaded.cleanup ?? null;
    if (this.options.scale != null) {
      this.modelScene.scale.setScalar(this.options.scale);
    }
    this.carrier = this.modelScene.getObjectByName("Empty") ?? this.modelScene;
    this.applyVisualOrientation();

    this.modelScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false; // the route hugs the camera; skinned bounds drift
      }
    });

    this.root.add(this.modelScene);

    if (loaded.animations.length > 0) {
      const wingClip =
        THREE.AnimationClip.findByName(loaded.animations, this.options.flapClipName) ??
        loaded.animations[0];
      this.mixer = new THREE.AnimationMixer(this.modelScene);
      if (wingClip) {
        this.wingAction = this.mixer.clipAction(wingClip);
        this.wingAction.timeScale = this.options.flapTimeScale;
        this.wingAction.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      }
    }

    if (!this.introPath) {
      this.createFallbackIntroPath();
    }
    this.createApproachCurve();
    this.createRouteDebugLine();
  }

  /** Anchor the route at the presenting camera and start (or restart) flying. */
  play(): boolean {
    if (!this.modelScene || !this.carrier) {
      return false;
    }

    this.anchorRootAtCamera();
    this.mixer?.stopAllAction();
    this.wingAction?.reset().play();
    this.routeHandoffQuaternion = null;
    this.applyFlightPathAt(0);
    this.elapsed = 0;
    this.exitStarted = false;
    this.exitCurve = null;
    this.isPlaying = true;
    this.isFinished = false;
    this.root.visible = true;
    return true;
  }

  update(deltaSeconds: number): void {
    if (!this.isPlaying) {
      return;
    }

    this.elapsed += deltaSeconds;
    this.mixer?.update(deltaSeconds);
    this.syncPositionSource();

    const flightDuration = this.options.approachDuration + this.introDuration;
    if (!this.exitStarted && this.elapsed >= flightDuration) {
      this.startExitFlight();
    }

    if (!this.exitStarted) {
      this.applyFlightPathAt(this.elapsed);
      return;
    }

    if (!this.exitCurve || !this.carrier) {
      return;
    }

    const exitElapsed = this.elapsed - flightDuration;
    const segmentRawProgress = THREE.MathUtils.clamp(exitElapsed / this.options.exitDuration, 0, 1);
    const progress = easeInExit(segmentRawProgress);

    this.exitCurve.getPointAt(progress, this._scratchPosition);
    const lookProgress = Math.min(progress + 0.08, 1);
    this.exitCurve.getPointAt(lookProgress, this._scratchLookAt);
    this.liftPathPointAboveGround(this._scratchPosition);
    this.liftPathPointAboveGround(this._scratchLookAt);

    this.carrier.position.copy(this._scratchPosition);
    this._scratchDirection.subVectors(this._scratchLookAt, this._scratchPosition);
    this.setCarrierForwardDirection(this._scratchDirection);

    if (segmentRawProgress >= EXIT_HIDE_PROGRESS) {
      this.isPlaying = false;
      this.isFinished = true;
      this.root.visible = false;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.modelCleanup?.();
    this.modelCleanup = null;

    if (this.mixer && this.modelScene) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.modelScene);
    }

    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
  }

  // ── anchoring & orientation ────────────────────────────────────

  /**
   * Place the route frame at the presenting camera's pose (VR-correct). The
   * anchor delivers a WORLD pose; when the root lives under a parent (the
   * player rig), it is converted into that parent's space so the route
   * travels with the rig from then on.
   */
  private anchorRootAtCamera(): void {
    if (this.options.positionSource) {
      this._positionSourceQuaternion.identity();
      if (this.options.alignToAnchorHeading) {
        this.options.anchor(this._scratchPosition, this._scratchQuaternion);
        this._scratchDirection.set(0, 0, -1).applyQuaternion(this._scratchQuaternion);
        this._scratchDirection.y = 0;
        if (this._scratchDirection.lengthSq() > 0.0001) {
          this._scratchDirection.normalize();
          this._positionSourceQuaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, -1),
            this._scratchDirection,
          );
        }
      }
      this.syncPositionSource();
      return;
    }

    this.options.anchor(this.root.position, this._scratchQuaternion);
    this.root.position.add(
      this._scratchDirection.copy(CAMERA_FORWARD_OFFSET).applyQuaternion(this._scratchQuaternion),
    );
    this.root.quaternion.copy(this._scratchQuaternion);

    const parent = this.root.parent;
    if (parent && parent !== this.scene) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.root.position);
      parent.getWorldQuaternion(this._scratchParentQuaternion).invert();
      this.root.quaternion.premultiply(this._scratchParentQuaternion);
    }
  }

  /** Follow source translation in world space while keeping the route's world
   * rotation fixed. Camera pose and source quaternion never enter this path. */
  private syncPositionSource(): void {
    const source = this.options.positionSource;
    if (!source) {
      return;
    }

    source.updateWorldMatrix(true, false);
    source.getWorldPosition(this.root.position);
    this.root.quaternion.copy(this._positionSourceQuaternion);

    const parent = this.root.parent;
    if (parent && parent !== this.scene) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.root.position);
      parent.getWorldQuaternion(this._scratchParentQuaternion).invert();
      this.root.quaternion.copy(this._scratchParentQuaternion);
    }
  }

  /** Lift one root-local path sample only when it would put the actor below
   * streamed terrain. Above-ground samples remain untouched. */
  private liftPathPointAboveGround(point: THREE.Vector3): void {
    const ground = this.options.ground;
    if (!ground) {
      return;
    }

    this._scratchWorldPosition.copy(point);
    this.root.localToWorld(this._scratchWorldPosition);
    const terrainY = ground(this._scratchWorldPosition.x, this._scratchWorldPosition.z);
    if (terrainY === null) {
      return;
    }

    const minimumY = terrainY + this.options.groundClearance;
    if (this._scratchWorldPosition.y >= minimumY) {
      return;
    }

    this._scratchWorldPosition.y = minimumY;
    this.root.worldToLocal(this._scratchWorldPosition);
    point.copy(this._scratchWorldPosition);
  }

  /**
   * Wrap the carrier's children in a rotation group so the model's own forward
   * axis lines up with the carrier's flight forward (+Y basis, see
   * {@link setCarrierForwardDirection}), plus authored fine-tune offsets.
   */
  private applyVisualOrientation(): void {
    if (!this.carrier || this.carrier.userData["visualOrientationApplied"]) {
      return;
    }

    const visualGroup = new THREE.Group();
    visualGroup.name = "BirdVisualOrientation";
    const forwardAlignment = new THREE.Quaternion().setFromUnitVectors(
      this.options.modelForward.clone().normalize(),
      new THREE.Vector3(0, 1, 0),
    );
    const rollCorrection = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.options.modelRollOffset,
    );
    const fineTune = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, this.options.modelYawOffset, this.options.modelZOffset),
    );
    visualGroup.quaternion.copy(forwardAlignment).premultiply(rollCorrection).multiply(fineTune);

    for (const child of [...this.carrier.children]) {
      visualGroup.add(child);
    }
    this.carrier.add(visualGroup);
    this.carrier.userData["visualOrientationApplied"] = true;
  }

  /** Build an orthonormal basis whose +Y column is the flight direction. */
  private setCarrierForwardDirection(direction: THREE.Vector3): void {
    if (!this.carrier || direction.lengthSq() < 0.0001) {
      return;
    }

    direction.normalize();
    this._scratchUp.set(0, 1, 0);
    if (Math.abs(direction.dot(this._scratchUp)) > 0.94) {
      this._scratchUp.set(0, 0, 1); // near-vertical flight: swap the reference up
    }

    this._scratchRight.crossVectors(this._scratchUp, direction).normalize();
    this._scratchBinormal.crossVectors(this._scratchRight, direction).normalize();
    this._scratchMatrix.makeBasis(this._scratchRight, direction, this._scratchBinormal);
    this.carrier.quaternion.setFromRotationMatrix(this._scratchMatrix);
  }

  // ── route construction ─────────────────────────────────────────

  private createIntroPathFromSource(source: LoadedBirdModel): void {
    const animationClip = source.animations.find((clip) =>
      clip.tracks.some((track) => track.name.endsWith(".position")),
    );

    if (animationClip) {
      this.createIntroPathFromClip(animationClip);
      return;
    }

    // Clip-less export: sample every vertex of the file as raw route points.
    const rawPoints: THREE.Vector3[] = [];
    source.scene.updateWorldMatrix(true, true);
    source.scene.traverse((child) => {
      const positionAttribute = (child as THREE.Mesh).geometry?.attributes?.["position"];
      if (!positionAttribute) {
        return;
      }
      for (let index = 0; index < positionAttribute.count; index += 1) {
        rawPoints.push(
          new THREE.Vector3()
            .fromBufferAttribute(positionAttribute, index)
            .applyMatrix4(child.matrixWorld),
        );
      }
    });

    const pathPoints = dedupePathPoints(rawPoints);
    if (pathPoints.length > 1) {
      this.useNormalizedIntroPoints(pathPoints, this.options.routeDuration);
    }
  }

  private createIntroPathFromClip(clip: THREE.AnimationClip): void {
    const positionTrack = clip.tracks.find((track) => track.name.endsWith(".position"));
    if (!positionTrack) {
      return;
    }

    const quaternionTrack = clip.tracks.find((track) => track.name.endsWith(".quaternion"));
    if (quaternionTrack) {
      this.createAnimatedRouteFromTrack(
        positionTrack,
        this.options.routeDuration || clip.duration,
        clip.duration,
      );
      return;
    }

    const values = positionTrack.values;
    const rawPoints: THREE.Vector3[] = [];
    for (let index = 0; index < values.length; index += 3) {
      rawPoints.push(new THREE.Vector3(values[index], values[index + 1], values[index + 2]));
    }
    if (rawPoints.length > 1) {
      this.useNormalizedIntroPoints(rawPoints, clip.duration, Array.from(positionTrack.times));
    }
  }

  /** The authored Empty's position track, resampled into the route frame. */
  private createAnimatedRouteFromTrack(
    positionTrack: THREE.KeyframeTrack,
    duration: number,
    sourceDuration: number,
  ): void {
    const values = positionTrack.values;
    const start = new THREE.Vector3(values[0], values[1], values[2]);
    const positions: THREE.Vector3[] = [];

    for (let index = 0; index < values.length; index += 3) {
      const sourcePoint = new THREE.Vector3(values[index], values[index + 1], values[index + 2]);
      positions.push(
        sourcePoint
          .sub(start)
          .multiplyScalar(this.options.routeScale)
          .applyQuaternion(this.options.routeRotation)
          .add(this.options.routeStart),
      );
    }

    this.animatedRoute = {
      positionTrack,
      start,
      sourceDuration,
      endDirection: this.getStableAnimatedRouteEndDirection(positionTrack, start, sourceDuration),
    };
    this.setIntroPath(positions, duration);
  }

  /**
   * Clip-less fallback: normalize raw points into a broad screen-space sweep in
   * front of the camera (largest axis → horizontal, second → vertical).
   */
  private useNormalizedIntroPoints(
    rawPoints: THREE.Vector3[],
    duration: number,
    sourceTimes: number[] | null = null,
  ): void {
    const axisNames = ["x", "y", "z"] as const;
    const bounds = {
      x: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      y: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      z: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    };

    for (const point of rawPoints) {
      for (const name of axisNames) {
        bounds[name].min = Math.min(bounds[name].min, point[name]);
        bounds[name].max = Math.max(bounds[name].max, point[name]);
      }
    }

    const axes = axisNames
      .map((name) => ({ name, range: Math.max(bounds[name].max - bounds[name].min, 0.0001) }))
      .sort((a, b) => b.range - a.range);
    const [horizontal, vertical, depth] = axes as [
      (typeof axes)[number],
      (typeof axes)[number],
      (typeof axes)[number],
    ];
    const firstPoint = rawPoints[0];
    if (!firstPoint) {
      return;
    }
    const firstHorizontalProgress =
      (firstPoint[horizontal.name] - bounds[horizontal.name].min) / horizontal.range;
    const flipHorizontal = firstHorizontalProgress > 0.5;
    const points: THREE.Vector3[] = [];

    for (const point of rawPoints) {
      const horizontalRaw =
        (point[horizontal.name] - bounds[horizontal.name].min) / horizontal.range;
      const horizontalProgress = flipHorizontal ? 1 - horizontalRaw : horizontalRaw;
      const verticalProgress = (point[vertical.name] - bounds[vertical.name].min) / vertical.range;
      const depthProgress = (point[depth.name] - bounds[depth.name].min) / depth.range;
      points.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(-9.2, 4.4, horizontalProgress),
          THREE.MathUtils.lerp(-1.35, 2.35, verticalProgress),
          -10.8 + (depthProgress - 0.5) * 0.35,
        ),
      );
    }

    this.setIntroPath(points, duration, sourceTimes);
  }

  private setIntroPath(
    points: THREE.Vector3[],
    duration: number,
    sourceTimes: number[] | null = null,
  ): void {
    const distances = [0];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      distances.push(
        (distances[index - 1] ?? 0) + (previous && current ? previous.distanceTo(current) : 0),
      );
    }

    const totalDistance = Math.max(distances[distances.length - 1] ?? 0, 0.0001);
    this.introDistance = totalDistance;
    this.introTimes = sourceTimes
      ? [...sourceTimes]
      : distances.map((distance) => (distance / totalDistance) * duration);
    this.introDuration = duration;
    this.introPath = points;
  }

  private createFallbackIntroPath(): void {
    this.setIntroPath(
      [
        new THREE.Vector3(-8.3, 0.18, -11.5),
        new THREE.Vector3(-6.4, 0.72, -11.1),
        new THREE.Vector3(-4.2, 0.28, -10.9),
        new THREE.Vector3(-1.4, 0.92, -11.4),
        new THREE.Vector3(1.3, 0.42, -10.7),
        new THREE.Vector3(3.9, 0.8, -11.2),
      ],
      this.options.routeDuration,
    );
  }

  /** Build a camera-local entry arc whose final tangent matches the authored
   * route's initial direction. This keeps position and heading continuous at
   * the hand-off, including for a reversed authored route. */
  private createApproachCurve(): void {
    const path = this.introPath;
    const configured = this.options.approachPoints;
    if (this.options.approachDuration <= 0 || configured.length === 0 || !path?.length) {
      this.approachCurve = null;
      return;
    }

    const entryIndex = this.options.introReverse ? path.length - 1 : 0;
    const nextIndex = this.options.introReverse ? Math.max(entryIndex - 1, 0) : 1;
    const entry = path[entryIndex];
    const next = path[nextIndex];
    if (!entry || !next) {
      this.approachCurve = null;
      return;
    }

    const routeDirection = next.clone().sub(entry);
    if (routeDirection.lengthSq() < 0.0001) {
      routeDirection.set(0, 0, -1);
    } else {
      routeDirection.normalize();
    }
    const handoff = entry.clone().addScaledVector(routeDirection, -2.5);
    const points = configured.map((point) => point.clone());
    const lastConfigured = points[points.length - 1];
    if (!lastConfigured || lastConfigured.distanceToSquared(handoff) > 0.01) {
      points.push(handoff);
    }
    points.push(entry.clone());
    this.approachCurve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.35);
  }

  private createRouteDebugLine(): void {
    if (!this.options.debugRoute || !this.introPath || this.routeLine) {
      return;
    }

    const approachPoints = this.approachCurve?.getPoints(32) ?? [];
    const routePoints = this.options.introReverse ? [...this.introPath].reverse() : this.introPath;
    const geometry = new THREE.BufferGeometry().setFromPoints([...approachPoints, ...routePoints]);
    const material = new THREE.LineBasicMaterial({
      color: 0xff8a00,
      transparent: true,
      opacity: 0.65,
    });
    this.routeLine = new THREE.Line(geometry, material);
    this.routeLine.name = "BirdFlightDebugRoute";
    this.routeLine.frustumCulled = false;
    this.root.add(this.routeLine);
  }

  /** Load an authored file — FBX or GLB, sniffed from the header bytes. */
  private async loadModel(modelUrl: string): Promise<LoadedBirdModel> {
    const buffer = (await this.fileLoader.loadAsync(modelUrl)) as ArrayBuffer;
    const header = new TextDecoder().decode(
      new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 24)),
    );
    const basePath = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);

    if (header.startsWith("Kaydara FBX")) {
      const object = this.fbxLoader.parse(buffer, basePath);
      return { scene: object, animations: object.animations };
    }

    return new Promise((resolve, reject) => {
      this.gltfLoader.parse(
        buffer,
        basePath,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        reject,
      );
    });
  }

  // ── route playback ─────────────────────────────────────────────

  private applyFlightPathAt(time: number): void {
    if (this.approachCurve && time < this.options.approachDuration) {
      this.applyApproachPathAt(time);
      return;
    }

    // Preserve the last orientation that was actually displayed on the
    // approach. The authored route blends away from it instead of replacing it
    // on the first frame after the phase boundary.
    if (this.approachCurve && !this.routeHandoffQuaternion && this.carrier) {
      this.routeHandoffQuaternion = this.carrier.quaternion.clone();
    }
    this.applyIntroPathAt(time - this.options.approachDuration);
  }

  /** Constant-speed sampling over the entry arc; the curve itself carries the
   * smooth bend, while the authored route owns the motion after the hand-off. */
  private applyApproachPathAt(time: number): void {
    if (!this.approachCurve || !this.carrier) {
      return;
    }
    const progress = THREE.MathUtils.clamp(
      time / Math.max(this.options.approachDuration, 0.0001),
      0,
      1,
    );
    this.approachCurve.getPointAt(progress, this._scratchPosition);
    this.approachCurve.getPointAt(Math.min(progress + 0.035, 1), this._scratchLookAt);
    this.liftPathPointAboveGround(this._scratchPosition);
    this.liftPathPointAboveGround(this._scratchLookAt);
    this.carrier.position.copy(this._scratchPosition);
    this._scratchDirection.subVectors(this._scratchLookAt, this._scratchPosition);
    this.setCarrierForwardDirection(this._scratchDirection);
  }

  private applyIntroPathAt(time: number): void {
    if (!this.introPath || this.introPath.length === 0 || !this.carrier) {
      return;
    }

    const sampledTime = this.options.introReverse ? this.introDuration - time : time;
    const clampedTime = THREE.MathUtils.clamp(sampledTime, 0, this.introDuration);

    if (this.animatedRoute) {
      this.sampleAnimatedRouteAt(clampedTime);
      this.blendRouteStartOrientation(time);
      return;
    }

    const lookAheadTime = Math.min(clampedTime + 0.08, this.introDuration);
    this.sampleIntroPathAt(clampedTime, this._scratchPosition);
    this.sampleIntroPathAt(lookAheadTime, this._scratchLookAt);
    this.liftPathPointAboveGround(this._scratchPosition);
    this.liftPathPointAboveGround(this._scratchLookAt);
    if (this._scratchLookAt.distanceToSquared(this._scratchPosition) < 0.0001) {
      // Route end: extrapolate the look-ahead from the last motion instead.
      const lookBackTime = Math.max(clampedTime - 0.14, 0);
      this.sampleIntroPathAt(lookBackTime, this._scratchLookAt);
      this.liftPathPointAboveGround(this._scratchLookAt);
      this._scratchLookAt.copy(
        this._scratchPosition.clone().sub(this._scratchLookAt).add(this._scratchPosition),
      );
      this.liftPathPointAboveGround(this._scratchLookAt);
    }

    this.carrier.position.copy(this._scratchPosition);
    this._scratchDirection.subVectors(this._scratchLookAt, this._scratchPosition);
    this.setCarrierForwardDirection(this._scratchDirection);
    this.blendRouteStartOrientation(time);
  }

  /** Keep the last approach rotation at the boundary, then ease it into the
   * authored route's independently sampled heading. */
  private blendRouteStartOrientation(time: number): void {
    if (!this.carrier || !this.routeHandoffQuaternion || time >= APPROACH_HANDOFF_BLEND_SECONDS) {
      return;
    }

    const blend = THREE.MathUtils.smoothstep(time, 0, APPROACH_HANDOFF_BLEND_SECONDS);
    this._scratchQuaternion.copy(this.carrier.quaternion);
    this.carrier.quaternion.copy(this.routeHandoffQuaternion).slerp(this._scratchQuaternion, blend);
  }

  private sampleAnimatedRouteAt(time: number): void {
    const route = this.animatedRoute;
    if (!route || !this.carrier) {
      return;
    }

    const sampledTime = this.getSpeedMatchedRouteTime(time);
    this.sampleIntroPathAt(sampledTime, this._scratchPosition);
    this.liftPathPointAboveGround(this._scratchPosition);
    this.carrier.position.copy(this._scratchPosition);

    const lookAheadTime = this.getSpeedMatchedRouteTime(Math.min(time + 0.08, this.introDuration));
    this.sampleIntroPathAt(lookAheadTime, this._scratchLookAt);
    this.liftPathPointAboveGround(this._scratchLookAt);
    if (this._scratchLookAt.distanceToSquared(this._scratchPosition) < 0.0001) {
      const lookBackTime = this.getSpeedMatchedRouteTime(Math.max(time - 0.14, 0));
      this.sampleIntroPathAt(lookBackTime, this._scratchLookAt);
      this.liftPathPointAboveGround(this._scratchLookAt);
      this._scratchLookAt.copy(
        this._scratchPosition.clone().sub(this._scratchLookAt).add(this._scratchPosition),
      );
      this.liftPathPointAboveGround(this._scratchLookAt);
    }

    this._scratchDirection.subVectors(this._scratchLookAt, this._scratchPosition);
    if (time >= this.introDuration - END_DIRECTION_LOCK_SECONDS) {
      this._scratchDirection.copy(route.endDirection);
    }
    this.setCarrierForwardDirection(this._scratchDirection);
  }

  /** Convert playback time to a distance-linear route sample. The first part
   * starts at the approach velocity and eases to a cruise velocity chosen so
   * the route still finishes at its configured duration. */
  private getSpeedMatchedRouteTime(time: number): number {
    const duration = Math.max(this.introDuration, 0.0001);
    const clampedTime = THREE.MathUtils.clamp(time, 0, duration);
    if (!this.approachCurve || this.options.approachDuration <= 0 || this.introDistance <= 0) {
      return this.options.introReverse ? duration - clampedTime : clampedTime;
    }

    const blendDuration = Math.min(APPROACH_HANDOFF_BLEND_SECONDS, duration);
    const maximumStartSpeed = (this.introDistance * 1.9) / Math.max(blendDuration, 0.0001);
    const startSpeed = Math.min(
      this.approachCurve.getLength() / this.options.approachDuration,
      maximumStartSpeed,
    );
    const cruiseSpeed =
      (this.introDistance - startSpeed * blendDuration * 0.5) /
      Math.max(duration - blendDuration * 0.5, 0.0001);

    let distance: number;
    if (clampedTime < blendDuration) {
      const acceleration = (cruiseSpeed - startSpeed) / Math.max(blendDuration, 0.0001);
      distance = startSpeed * clampedTime + acceleration * clampedTime * clampedTime * 0.5;
    } else {
      const blendDistance = (startSpeed + cruiseSpeed) * blendDuration * 0.5;
      distance = blendDistance + cruiseSpeed * (clampedTime - blendDuration);
    }

    const routeTime =
      THREE.MathUtils.clamp(distance / this.introDistance, 0, 1) * this.introDuration;
    return this.options.introReverse ? duration - routeTime : routeTime;
  }

  private getStableAnimatedRouteEndDirection(
    positionTrack: THREE.KeyframeTrack,
    start: THREE.Vector3,
    sourceDuration: number,
  ): THREE.Vector3 {
    const fromTime = Math.max(sourceDuration - 0.55, 0);
    const toTime = Math.max(sourceDuration - 0.18, fromTime + 0.01);
    const fromPoint = new THREE.Vector3();
    const toPoint = new THREE.Vector3();

    sampleVectorTrackAt(positionTrack, fromTime, fromPoint);
    sampleVectorTrackAt(positionTrack, toTime, toPoint);
    fromPoint
      .sub(start)
      .multiplyScalar(this.options.routeScale)
      .applyQuaternion(this.options.routeRotation)
      .add(this.options.routeStart);
    toPoint
      .sub(start)
      .multiplyScalar(this.options.routeScale)
      .applyQuaternion(this.options.routeRotation)
      .add(this.options.routeStart);

    const direction = toPoint.sub(fromPoint);
    if (direction.lengthSq() < 0.0001) {
      return new THREE.Vector3(0, 1, 0);
    }
    return direction.normalize();
  }

  private sampleIntroPathAt(time: number, target: THREE.Vector3): THREE.Vector3 {
    const path = this.introPath;
    if (!path || path.length === 0) {
      return target.set(0, 0, 0);
    }

    const first = path[0] as THREE.Vector3;
    if (path.length === 1 || time <= (this.introTimes[0] ?? 0)) {
      return target.copy(first);
    }

    const lastIndex = path.length - 1;
    const last = path[lastIndex] as THREE.Vector3;
    if (time >= (this.introTimes[lastIndex] ?? 0)) {
      return target.copy(last);
    }

    for (let index = 0; index < lastIndex; index += 1) {
      const startTime = this.introTimes[index] ?? 0;
      const endTime = this.introTimes[index + 1] ?? 0;
      if (time >= startTime && time <= endTime) {
        const segmentProgress = (time - startTime) / Math.max(endTime - startTime, 0.0001);
        return target
          .copy(path[index] as THREE.Vector3)
          .lerp(path[index + 1] as THREE.Vector3, segmentProgress);
      }
    }

    return target.copy(last);
  }

  /** The outward departure: a CatmullRom continuing the route's last heading. */
  private startExitFlight(): void {
    if (!this.carrier) {
      return;
    }
    this.exitStarted = true;
    this.applyIntroPathAt(this.introDuration);

    const start = this.carrier.position.clone();
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(this.carrier.quaternion).normalize();
    const lift = new THREE.Vector3(0, 1, 0);
    this.exitCurve = new THREE.CatmullRomCurve3(
      [
        start,
        start.clone().add(forward.clone().multiplyScalar(4)).add(lift.clone().multiplyScalar(0.12)),
        start
          .clone()
          .add(forward.clone().multiplyScalar(11))
          .add(lift.clone().multiplyScalar(0.35)),
        start
          .clone()
          .add(forward.clone().multiplyScalar(24))
          .add(lift.clone().multiplyScalar(0.72)),
        start
          .clone()
          .add(forward.clone().multiplyScalar(55))
          .add(lift.clone().multiplyScalar(1.05)),
      ],
      false,
      "centripetal",
      0.2,
    );
  }
}

/** Linearly sample a Vector3 keyframe track at `time`. */
function sampleVectorTrackAt(
  track: THREE.KeyframeTrack,
  time: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const times = track.times;
  const values = track.values;

  if (time <= (times[0] ?? 0)) {
    return target.set(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  }

  const lastIndex = times.length - 1;
  if (time >= (times[lastIndex] ?? 0)) {
    const valueIndex = lastIndex * 3;
    return target.set(
      values[valueIndex] ?? 0,
      values[valueIndex + 1] ?? 0,
      values[valueIndex + 2] ?? 0,
    );
  }

  for (let index = 0; index < lastIndex; index += 1) {
    const startTime = times[index] ?? 0;
    const endTime = times[index + 1] ?? 0;
    if (time >= startTime && time <= endTime) {
      const valueIndex = index * 3;
      const nextValueIndex = (index + 1) * 3;
      const progress = (time - startTime) / Math.max(endTime - startTime, 0.0001);
      return target
        .set(values[valueIndex] ?? 0, values[valueIndex + 1] ?? 0, values[valueIndex + 2] ?? 0)
        .lerp(
          new THREE.Vector3(
            values[nextValueIndex] ?? 0,
            values[nextValueIndex + 1] ?? 0,
            values[nextValueIndex + 2] ?? 0,
          ),
          progress,
        );
    }
  }

  return target;
}

/** Drop consecutive duplicate points from a raw vertex sweep. */
function dedupePathPoints(rawPoints: THREE.Vector3[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const seen = new Set<string>();
  for (const point of rawPoints) {
    const key = `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push(point.clone());
    }
  }
  return points;
}

/** Ease-in for the exit segment: slow hand-off, accelerating departure. */
function easeInExit(value: number): number {
  return value * value;
}
