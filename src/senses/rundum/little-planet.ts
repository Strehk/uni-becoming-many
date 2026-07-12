// ── SENSE MODULE: Rundum — the little-planet 360° projection ───
//
// Ported from 360_sinn_modul `src/LittlePlanetRenderer.js`: captures the host scene
// into a cubemap each frame and projects it with a little-planet mapping onto a
// fullscreen quad — the whole world curls into a sphere below the player.
//
// Changes from the prototype: WebGLCubeRenderTarget → `THREE.CubeRenderTarget`
// (the WebGPU-compatible variant) and the GLSL fullscreen shader → a TSL node
// graph (`cubeTexture` lookup, exposure/contrast/vignette as live uniforms).
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import {
  clamp,
  cos,
  cubeTexture,
  dot,
  length,
  mix,
  normalize,
  oneMinus,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

export interface LittlePlanetOptions {
  cubeSize: number;
  near: number;
  far: number;
  zoom: number;
  yawOffset: number;
  exposure: number;
  contrast: number;
  vignette: number;
  centerLift: number;
}

export const LITTLE_PLANET_DEFAULTS: LittlePlanetOptions = {
  cubeSize: 1024,
  near: 0.25,
  far: 620,
  zoom: 1.04,
  yawOffset: 0,
  exposure: 1.05,
  contrast: 1.08,
  vignette: 0.32,
  centerLift: 0.05,
};

const _size = new THREE.Vector2();
const _position = new THREE.Vector3();
const _forward = new THREE.Vector3();

export interface LittlePlanetRenderArgs {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  hiddenObjects?: readonly THREE.Object3D[];
}

export class LittlePlanetRenderer {
  private options: LittlePlanetOptions;
  private readonly cubeTarget: THREE.CubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly quadScene: THREE.Scene;
  private readonly quadCamera: THREE.OrthographicCamera;
  private readonly quad: THREE.Mesh;
  private readonly material: THREE.MeshBasicNodeMaterial;

  private readonly uAspect = uniform(1);
  private readonly uYaw = uniform(0);
  private readonly uZoom = uniform(LITTLE_PLANET_DEFAULTS.zoom);
  private readonly uExposure = uniform(LITTLE_PLANET_DEFAULTS.exposure);
  private readonly uContrast = uniform(LITTLE_PLANET_DEFAULTS.contrast);
  private readonly uVignette = uniform(LITTLE_PLANET_DEFAULTS.vignette);
  private readonly uCenterLift = uniform(LITTLE_PLANET_DEFAULTS.centerLift);

  constructor(options: Partial<LittlePlanetOptions> = {}) {
    this.options = { ...LITTLE_PLANET_DEFAULTS, ...options };
    this.cubeTarget = new THREE.CubeRenderTarget(this.options.cubeSize);
    this.cubeCamera = new THREE.CubeCamera(this.options.near, this.options.far, this.cubeTarget);
    this.applyOptions();

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const material = new THREE.MeshBasicNodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;

    // ── the little-planet mapping (TSL port of the GLSL fragment) ──
    const p = uv().mul(2.0).sub(1.0).mul(vec2(this.uAspect, 1.0)).div(this.uZoom.max(0.001));
    const r2 = dot(p, p);
    const planetDir = normalize(
      vec3(p.x.mul(2.0), r2.sub(1.0).add(this.uCenterLift), p.y.mul(-2.0)),
    );
    // rotate around the up axis by yaw
    const s = sin(this.uYaw);
    const c = cos(this.uYaw);
    const rotated = vec3(
      planetDir.x.mul(c).sub(planetDir.z.mul(s)),
      planetDir.y,
      planetDir.x.mul(s).add(planetDir.z.mul(c)),
    );
    const sampled = cubeTexture(this.cubeTarget.texture, rotated).rgb;
    const exposed = sampled.mul(this.uExposure);
    const contrasted = clamp(exposed.sub(0.5).mul(this.uContrast).add(0.5), 0.0, 1.0);
    const vignette = smoothstep(1.8, 0.18, length(p));
    material.colorNode = contrasted.mul(mix(oneMinus(this.uVignette), 1.0, vignette));
    this.material = material;

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setOptions(options: Partial<LittlePlanetOptions>): void {
    this.options = { ...this.options, ...options };
    this.applyOptions();
  }

  get currentOptions(): Readonly<LittlePlanetOptions> {
    return this.options;
  }

  private applyOptions(): void {
    // CubeCamera holds six child PerspectiveCameras — near/far live on those.
    for (const child of this.cubeCamera.children) {
      if (child instanceof THREE.PerspectiveCamera) {
        child.near = this.options.near;
        child.far = this.options.far;
        child.updateProjectionMatrix();
      }
    }
    this.uZoom.value = this.options.zoom;
    this.uExposure.value = this.options.exposure;
    this.uContrast.value = this.options.contrast;
    this.uVignette.value = this.options.vignette;
    this.uCenterLift.value = this.options.centerLift;
  }

  /** Capture the scene into the cubemap and draw the projection. Replaces the
   *  default render pass for this frame. */
  render({ renderer, scene, camera, hiddenObjects = [] }: LittlePlanetRenderArgs): void {
    renderer.getDrawingBufferSize(_size);
    this.uAspect.value = _size.x / Math.max(1, _size.y);

    camera.getWorldPosition(_position);
    camera.getWorldDirection(_forward);
    this.cubeCamera.position.copy(_position);
    this.uYaw.value = Math.atan2(_forward.x, _forward.z) + this.options.yawOffset;

    const hiddenStates = hiddenObjects.map((object) => ({ object, visible: object.visible }));
    for (const { object } of hiddenStates) {
      object.visible = false;
    }

    this.cubeCamera.update(renderer, scene);

    for (const { object, visible } of hiddenStates) {
      object.visible = visible;
    }

    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
