// WebGPU renderer for `becoming-many`.
//
// PARADIGMS (see AGENT.md — these are hard rules, enforced here):
//   1. Import the renderer + node materials from `three/webgpu`, and every TSL node
//      function from `three/tsl`. Never the classic WebGL `three` entry.
//   2. Express all shading/animation as TSL node graphs — no GLSL strings, no classic
//      (non-`Node`) materials.
//   3. When the app needs GPU-resident simulation state, it lives in a "Rendering
//      BufferArray" — a storage buffer (TSL `instancedArray`) that compute nodes write and
//      material nodes read, exposed on the `Renderer` so the app works *through* it rather
//      than passing CPU arrays around. None is allocated yet: the streamed terrain world
//      owns its own GPU state, so this renderer just sets up the device, scene, and camera.
//
// VR: WebGPU drives WebXR through the same `renderer.xr` manager as the WebGL backend
// (supported since r167; uses an internal `XRGPUBinding`). We flip `renderer.xr.enabled`
// on and expose a `VRButton` overlay; entering VR needs HTTPS (we already serve it).

// `three/addons/*` maps to `three/examples/jsm/*`; types ship with @types/three.
import { Inspector } from "three/addons/inspector/Inspector.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import * as THREE from "three/webgpu";
import { SHOW_GRID_FLOOR, createGridFloor } from "./grid-floor";

export interface Renderer {
  /**
   * The underlying three.js WebGPU renderer. Exposed for dev tooling / diagnostics
   * (frame stats, GPU timing); app code should prefer the higher-level fields below.
   */
  readonly instance: THREE.WebGPURenderer;
  /** The WebGPU canvas, ready to mount into the DOM. */
  readonly canvas: HTMLCanvasElement;
  /** "Enter VR" overlay button; mount it anywhere in the DOM. */
  readonly vrButton: HTMLElement;
  /** The scene graph — add world objects (e.g. a player rig) to it. */
  readonly scene: THREE.Scene;
  /** The camera. Prefer moving a parent rig over mutating this directly (VR owns its pose). */
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Begin the animation loop (per-frame `onFrame` → render).
   * @param onFrame optional callback given the seconds elapsed since the previous frame.
   */
  start(onFrame?: (dtSeconds: number) => void): void;
  /** Stop the loop, drop listeners, and release GPU resources. */
  dispose(): void;
}

/**
 * Create the WebGPU renderer and its scene.
 *
 * Async because `WebGPURenderer` must `await renderer.init()` before its first frame —
 * skipping it yields a blank canvas with no error. Importing from `three/webgpu` also
 * gives an automatic WebGL2 fallback when WebGPU is unavailable.
 */
export async function createRenderer(): Promise<Renderer> {
  // `trackTimestamp` records GPU frame timing (needs the `timestamp-query` feature); the
  // Inspector's Performance tab reads it.
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    trackTimestamp: true,
    forceWebGL: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; // route the render loop through WebXR when a session starts

  // three.js WebGPU dev panel (Performance / Console / Parameters / Viewer tabs), as used
  // in the official webgpu_compute_particles_fluid example. MUST be assigned BEFORE
  // `init()` — the panel's DOM is mounted from inside the renderer's own init. It ships its
  // own toggle button and self-mounts next to the canvas (via a MutationObserver if the
  // canvas isn't in the DOM yet), so no manual DOM wiring is needed.
  renderer.inspector = new Inspector();

  await renderer.init();

  // "Enter VR" button; three handles the session + per-eye cameras once it's clicked.
  const vrButton = VRButton.createButton(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  // Eye height (~1.6 m). In VR the headset overrides this transform, but the rig's
  // floor-relative origin means starting here keeps the world at a natural height.
  camera.position.set(0, 1.6, 0);

  // Initial grid floor: a spatial reference from when the world was empty. Superseded by the
  // terrain world, so it is disabled by default — see `src/renderer/grid-floor.ts`. Flip
  // `SHOW_GRID_FLOOR` there to bring it back.
  if (SHOW_GRID_FLOOR) {
    scene.add(createGridFloor());
  }

  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };

  function start(onFrame?: (dtSeconds: number) => void): void {
    window.addEventListener("resize", onResize);
    let lastMs = 0;
    renderer.setAnimationLoop((nowMs: number) => {
      const dtSeconds = lastMs === 0 ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      onFrame?.(dtSeconds);
      renderer.render(scene, camera);
    });
  }

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    void renderer.setAnimationLoop(null);
    renderer.dispose();
  }

  return {
    instance: renderer,
    canvas: renderer.domElement,
    vrButton,
    scene,
    camera,
    start,
    dispose,
  };
}
