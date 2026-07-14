// ── Becoming Many — Shared Camera Position ─────────────────────
//
// One world-space camera-position uniform, refreshed each frame from the *presenting*
// camera: the XR headset rig while a VR session runs, the mono app camera otherwise.
//
// WHY THIS EXISTS — VR workaround. Every camera-relative look effect (view reveal,
// distance fog, fresnel rim, the dust near/far fades) needs "where the eye is". The
// natural choice is the TSL `cameraPosition` node, but under the WebGPU backend's
// WebXR path that node does not resolve to the live per-eye headset camera, so in VR
// the whole void/fog/dust math collapses — the terrain pins to the near/dark end of
// its ramp (renders black) and every dust mote falls inside its "invisible < 1.5 m"
// cut (the field vanishes), while the flat `scene.background` (no camera math) stays
// correct. Feeding an explicit uniform we update on the CPU sidesteps the node.
//
// The surface kit (`tsl-kit.ts`) and the dust material read this instead of
// `cameraPosition`; `syncCameraPos` runs once per frame before the render pass.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`.

import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/** Live world-space position of the presenting camera. Use in camera-relative look
 *  math INSTEAD of the TSL `cameraPosition` node so VR renders correctly. */
export const cameraPos = uniform(new THREE.Vector3());

/** Live view-projection of the presenting camera, for CPU-side frustum culling (grass).
 *  In VR this is the XR rig's union frustum (both eyes) — the value the mono camera's
 *  matrices can't give. Updated in lockstep with {@link cameraPos}. */
export const cameraViewProjection = new THREE.Matrix4();

const scratch = new THREE.Vector3();

/**
 * Copy the presenting camera's world position into {@link cameraPos} and its
 * view-projection into {@link cameraViewProjection}. Call once per frame, before
 * rendering. `mono` is the app camera; when an XR session presents,
 * `renderer.xr.getCamera()` (the stereo rig, positioned at the eyes' midpoint,
 * carrying a union frustum over both eyes) overrides it so the fades and the grass
 * cull track the real head instead of the pre-XR pose.
 */
export function syncCameraPos(renderer: THREE.WebGPURenderer, mono: THREE.Camera): void {
  if (renderer.xr.isPresenting) {
    // The XR camera's world pose is three-managed: each render it writes
    // `cameraXR.matrixWorld = rig.matrixWorld × headLocalPose` (the real world head).
    // Read that matrix DIRECTLY — do NOT call `getWorldPosition()`/`updateMatrixWorld()`
    // on it. The XR camera has no scene-graph parent, so those recompute `matrixWorld`
    // from its LOCAL (reference-space) transform and drop the rig, pinning the eye near
    // the origin while the player flies away (dust vanishes, terrain fog collapses).
    // These matrices are last frame's values (sync runs before render) — one frame stale
    // is imperceptible, and the grass cull already carries a radius margin.
    const xr = renderer.xr.getCamera();
    scratch.setFromMatrixPosition(xr.matrixWorld);
    cameraViewProjection.multiplyMatrices(xr.projectionMatrix, xr.matrixWorldInverse);
  } else {
    // Mono is a normal scene-graph camera: `getWorldPosition` correctly composes the rig
    // parent chain. Refresh its inverse now (the renderer only inverts during render, so
    // without this the cull frustum would lag a frame).
    mono.getWorldPosition(scratch);
    mono.matrixWorldInverse.copy(mono.matrixWorld).invert();
    cameraViewProjection.multiplyMatrices(mono.projectionMatrix, mono.matrixWorldInverse);
  }
  cameraPos.value.copy(scratch);
}
