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

const scratch = new THREE.Vector3();

/**
 * Copy the presenting camera's world position into {@link cameraPos}. Call once per
 * frame, before rendering. `mono` is the app camera; when an XR session presents,
 * `renderer.xr.getCamera()` (the stereo rig, positioned at the eyes' midpoint)
 * overrides it so the fades track the real head instead of the pre-XR pose.
 */
export function syncCameraPos(renderer: THREE.WebGPURenderer, mono: THREE.Camera): void {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : mono;
  cam.getWorldPosition(scratch);
  cameraPos.value.copy(scratch);
}
