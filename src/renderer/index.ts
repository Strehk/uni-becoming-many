// WebGPU renderer for `becoming-many`.
//
// PARADIGMS (see AGENT.md — these are hard rules, enforced here):
//   1. Import the renderer + node materials from `three/webgpu`, and every TSL node
//      function from `three/tsl`. Never the classic WebGL `three` entry.
//   2. Express all shading/animation as TSL node graphs — no GLSL strings, no classic
//      (non-`Node`) materials.
//   3. The "Rendering BufferArray" is the source of truth. It is a GPU-resident storage
//      buffer (TSL `instancedArray`). Compute nodes write it, material nodes read it, and
//      it is exposed on the `Renderer` so the rest of the app works *through* it rather
//      than passing CPU arrays around.
//
// The scene below is deliberately the smallest thing that exercises all three: one plane
// whose color is read from the buffer, and one compute pass that animates the buffer.
//
// VR: WebGPU drives WebXR through the same `renderer.xr` manager as the WebGL backend
// (supported since r167; uses an internal `XRGPUBinding`). We flip `renderer.xr.enabled`
// on and expose a `VRButton` overlay; entering VR needs HTTPS (we already serve it).

// `three/addons/*` maps to `three/examples/jsm/*`; types ship with @types/three.
import { Inspector } from "three/addons/inspector/Inspector.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import {
  Fn,
  float,
  instancedArray,
  min,
  mix,
  positionWorld,
  smoothstep,
  time,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

/** Grid floor cell size, in world units (metres) — a spatial reference so flight is visible. */
const GRID_CELL = 2;

/**
 * Length of the Rendering BufferArray. For now it holds a single RGB color (one `vec3`);
 * grow this as the simulation state grows.
 */
const BUFFER_LENGTH = 1;

/**
 * Allocate the Rendering BufferArray: a GPU-resident `vec3` storage buffer.
 *
 * Kept as a named factory so the public {@link Renderer} interface can derive its type
 * (`RenderBuffer`) without naming three's internal node classes — none of which are
 * exported from `three/tsl`.
 */
function createBuffer() {
  return instancedArray(BUFFER_LENGTH, "vec3");
}

/** The Rendering BufferArray — the app's GPU-resident source of truth. */
export type RenderBuffer = ReturnType<typeof createBuffer>;

export interface Renderer {
  /** The WebGPU canvas, ready to mount into the DOM. */
  readonly canvas: HTMLCanvasElement;
  /** "Enter VR" overlay button; mount it anywhere in the DOM. */
  readonly vrButton: HTMLElement;
  /** The Rendering BufferArray. Read from / write to this everywhere. */
  readonly buffer: RenderBuffer;
  /** The scene graph — add world objects (e.g. a player rig) to it. */
  readonly scene: THREE.Scene;
  /** The camera. Prefer moving a parent rig over mutating this directly (VR owns its pose). */
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Begin the animation loop (per-frame `onFrame` → compute → render).
   * @param onFrame optional callback given the seconds elapsed since the previous frame.
   */
  start(onFrame?: (dtSeconds: number) => void): void;
  /** Stop the loop, drop listeners, and release GPU resources. */
  dispose(): void;
}

/**
 * Create the WebGPU renderer and its minimal TSL scene.
 *
 * Async because `WebGPURenderer` must `await renderer.init()` before its first frame —
 * skipping it yields a blank canvas with no error. Importing from `three/webgpu` also
 * gives an automatic WebGL2 fallback when WebGPU is unavailable.
 */
export async function createRenderer(): Promise<Renderer> {
  // `trackTimestamp` records GPU frame timing (needs the `timestamp-query` feature); the
  // Inspector's Performance tab reads it.
  const renderer = new THREE.WebGPURenderer({ antialias: true, trackTimestamp: true });
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

  // --- The Rendering BufferArray: GPU-resident source of truth. ---
  const buffer = createBuffer();

  // Compute pass: animate the buffer's single color from elapsed `time`. Built once;
  // re-dispatched every frame in the loop. This is how state enters the buffer.
  const update = Fn(() => {
    const r = time.sin().mul(0.5).add(0.5);
    const g = time.mul(0.7).cos().mul(0.5).add(0.5);
    buffer.element(0).assign(vec3(r, g, 0.5));
  })().compute(BUFFER_LENGTH);

  // Scene: one plane whose color is *read* from the buffer.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  // Eye height (~1.6 m). In VR the headset overrides this transform, but the rig's
  // floor-relative origin means starting here keeps the plane in front of the user.
  camera.position.set(0, 1.6, 0);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(buffer.element(0), 1.0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.position.set(0, 1.6, -3); // 3 m ahead at eye height — visible in VR and on desktop
  scene.add(mesh);

  // Grid floor: a spatial reference so flying reads as motion. Pure TSL — the colour is a
  // function of world XZ position, so the grid stays fixed in the world as the player moves
  // over it. Anti-aliased lines every `GRID_CELL` units.
  const floorMaterial = new THREE.MeshBasicNodeMaterial();
  floorMaterial.colorNode = Fn(() => {
    const cell = positionWorld.xz.div(GRID_CELL);
    const f = cell.fract();
    const toLine = min(f, f.oneMinus()); // per-axis distance to the nearest grid line
    const line = smoothstep(float(0), float(0.05), min(toLine.x, toLine.y)).oneMinus();
    return vec4(mix(vec3(0.04, 0.06, 0.09), vec3(0.22, 0.32, 0.48), line), 1.0);
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), floorMaterial);
  floor.rotation.x = -Math.PI / 2; // lay the XY plane flat onto the XZ ground
  scene.add(floor);

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
      void renderer.computeAsync(update);
      renderer.render(scene, camera);
    });
  }

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    void renderer.setAnimationLoop(null);
    renderer.dispose();
  }

  return { canvas: renderer.domElement, vrButton, buffer, scene, camera, start, dispose };
}
