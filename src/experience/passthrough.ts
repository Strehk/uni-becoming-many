// ── Becoming Many — AR ⇆ VR passthrough veil ───────────────────
//
// The piece opens in AR passthrough (the audience sees the real room to get into
// position), fades to de-facto VR once it begins, and fades back to AR at the end. That
// whole crossfade is one scalar `arVeil` (0 = AR passthrough, 1 = VR opaque), authored on
// the Theatre timeline (`passthrough.vrBlend`) and pumped in each frame from main.ts.
//
// This module owns the two view-level pieces of that fade (the world SURFACES fade via
// the shared `u.worldOpacity` uniform, wired in the materials themselves):
//
//   1. A **backdrop veil dome** — a large inward sphere that follows the player, tinted
//      with the live `fogColor` (so it matches the void/sense sky). Its opacity is
//      `arVeil`, expressed as MSAA coverage in the OPAQUE pass (the WebGPU-XR transparent
//      pass does not present — see src/atmosphere/material.ts). At `arVeil = 1` it fills
//      the view with the fog colour (exactly today's `scene.background` look → VR); at 0
//      its coverage is 0 → the passthrough camera feed shows through (AR). The dust motes,
//      being opaque and drawn separately, stay visible throughout.
//
//   2. **`scene.background` + clear alpha** — while an AR passthrough session presents, the
//      background must be `null` and the framebuffer must clear to alpha 0 so the compositor
//      shows the real world; otherwise (plain VR / desktop) the background is the live
//      `fogColor` exactly as before. Managed on the renderer's XR `sessionstart`/`sessionend`.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes from
// `three/webgpu`. No GLSL, no classic materials.

import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";

/** Backdrop radius, in metres: beyond the fog, inside the camera's 1000 m far plane. */
const DOME_RADIUS = 800;

export interface Passthrough {
  /**
   * Drive the veil from `arVeil` (0 = AR passthrough, 1 = VR opaque) and centre the dome on
   * the player. Call once per frame, after the player pose is current.
   */
  update(arVeil: number, x: number, y: number, z: number): void;
  dispose(): void;
}

export interface PassthroughOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
  /** The live sense uniforms — the dome wears `fogColor`, and `fogColor.value` restores the
   *  background outside AR. */
  uniforms: KitUniforms;
  /** True while an AR passthrough session presents (renderer.isPassthrough). */
  isPassthrough(): boolean;
}

export function createPassthrough(opts: PassthroughOptions): Passthrough {
  const { scene, renderer, uniforms } = opts;

  // Opacity of the whole backdrop: 1 = solid fog sky (VR), 0 = gone (AR passthrough).
  const uOpacity = uniform(1);

  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.BackSide; // seen from the inside
  material.colorNode = uniforms.fogColor; // match the live void / sense sky colour
  material.opacityNode = uOpacity;
  // Opaque pass, MSAA coverage — the only path that presents in WebGPU-XR (see header).
  material.transparent = false;
  material.depthWrite = false;
  material.alphaToCoverage = true;
  material.toneMapped = false;

  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 64, 32), material);
  dome.frustumCulled = false;
  dome.renderOrder = -2; // draw first — the farthest backdrop, behind even the sky dome
  // Only needed in AR: outside passthrough the opaque `scene.background` fills the sky, so the
  // dome stays hidden → zero visual change (and no redundant draw) in plain VR / desktop.
  dome.visible = false;
  scene.add(dome);

  // Background transparency follows the session: AR passthrough ⇒ transparent clear + the
  // fadeable dome backdrop so the real world can show; VR / desktop ⇒ the live fog colour
  // exactly as before, dome hidden.
  const applyBackgroundMode = (): void => {
    const passthrough = opts.isPassthrough();
    dome.visible = passthrough;
    if (passthrough) {
      scene.background = null;
      renderer.setClearAlpha(0);
    } else {
      scene.background = uniforms.fogColor.value;
      renderer.setClearAlpha(1);
    }
  };
  applyBackgroundMode();
  renderer.xr.addEventListener("sessionstart", applyBackgroundMode);
  renderer.xr.addEventListener("sessionend", applyBackgroundMode);

  return {
    update(arVeil: number, x: number, y: number, z: number): void {
      uOpacity.value = arVeil;
      dome.position.set(x, y, z);
    },
    dispose(): void {
      renderer.xr.removeEventListener("sessionstart", applyBackgroundMode);
      renderer.xr.removeEventListener("sessionend", applyBackgroundMode);
      dome.removeFromParent();
      dome.geometry.dispose();
      material.dispose();
    },
  };
}
