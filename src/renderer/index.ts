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

import { Fn, instancedArray, time, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

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
  /** The Rendering BufferArray. Read from / write to this everywhere. */
  readonly buffer: RenderBuffer;
  /** Begin the animation loop (compute → render each frame). */
  start(): void;
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
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();

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
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 2;

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(buffer.element(0), 1.0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  scene.add(mesh);

  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };

  function start(): void {
    window.addEventListener("resize", onResize);
    renderer.setAnimationLoop(() => {
      void renderer.computeAsync(update);
      renderer.render(scene, camera);
    });
  }

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    void renderer.setAnimationLoop(null);
    renderer.dispose();
  }

  return { canvas: renderer.domElement, buffer, start, dispose };
}
