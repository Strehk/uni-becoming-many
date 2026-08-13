// ── Becoming Many — XR entry button (AR-first, VR fallback) ────
//
// One "enter XR" button that prefers an **immersive-ar** (passthrough) session so the
// piece can open in AR — the audience sees the real room while getting into position —
// and only falls back to **immersive-vr** when the device/runtime can't grant AR. The
// AR→VR→AR crossfade happens *inside* the AR session by ramping drawn opacity (see
// src/experience/passthrough.ts); we never restart the session to change modes.
//
// This replaces the stock three `VRButton`/`ARButton` addons because:
//   • VRButton is hard-wired to `immersive-vr` (no AR path);
//   • ARButton forces a `local` reference space + a DOM-overlay close button and is typed
//     for `WebGLRenderer`, which fights the strict WebGPU types here.
// A tiny custom button gives full control and stays inside the type gates (no `as`/`any`).
//
// The WebGPU backend's XRManager REJECTS any immersive session that wasn't granted the
// "webgpu" session feature (it drives the headset through an XRGPUBinding projection
// layer), so we request it as a *required* feature — the same rule the old VRButton call
// relied on. Optional floor/layers features mirror the stock VRButton.
//
// The element keeps `id="VRButton"` so the existing interface-mode show/hide wiring
// (which targets `#VRButton`) keeps working unchanged.

import type * as THREE from "three/webgpu";

export interface XrEntry {
  /** The button element — mount it anywhere; carries `id="VRButton"`. */
  readonly element: HTMLElement;
  /** True while an AR passthrough session presents (blend mode is not "opaque"). */
  isPassthrough(): boolean;
}

/** Blend modes that composite over a real-world feed — i.e. passthrough is visible. */
const PASSTHROUGH_MODES: ReadonlySet<XREnvironmentBlendMode> = new Set(["additive", "alpha-blend"]);

function stylize(button: HTMLElement): void {
  button.style.position = "absolute";
  button.style.bottom = "20px";
  button.style.left = "calc(50% - 50px)";
  button.style.width = "100px";
  button.style.padding = "12px 6px";
  button.style.border = "1px solid #fff";
  button.style.borderRadius = "4px";
  button.style.background = "rgba(0,0,0,0.1)";
  button.style.color = "#fff";
  button.style.font = "normal 13px sans-serif";
  button.style.textAlign = "center";
  button.style.opacity = "0.5";
  button.style.outline = "none";
  button.style.cursor = "pointer";
  button.style.zIndex = "999";
}

/**
 * Build the XR entry button. Async because WebXR support detection
 * (`isSessionSupported`) is promise-based; `createRenderer` already awaits, so the button
 * is fully wired before it is mounted.
 */
export async function createXrButton(renderer: THREE.WebGPURenderer): Promise<XrEntry> {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "VRButton";
  stylize(button);

  const xr = navigator.xr;
  if (!xr) {
    button.textContent = "WEBXR N/A";
    button.disabled = true;
    return { element: button, isPassthrough: () => false };
  }

  // Prefer AR (passthrough) so the piece can open in AR; fall back to plain VR.
  const arSupported = await xr.isSessionSupported("immersive-ar").catch(() => false);
  const vrSupported =
    arSupported || (await xr.isSessionSupported("immersive-vr").catch(() => false));

  if (!arSupported && !vrSupported) {
    button.textContent = "XR N/A";
    button.disabled = true;
    return { element: button, isPassthrough: () => false };
  }

  const mode: XRSessionMode = arSupported ? "immersive-ar" : "immersive-vr";
  const enterLabel = arSupported ? "AR STARTEN" : "VR STARTEN";
  const exitLabel = arSupported ? "AR BEENDEN" : "VR BEENDEN";
  button.textContent = enterLabel;

  button.addEventListener("mouseenter", () => {
    button.style.opacity = "1.0";
  });
  button.addEventListener("mouseleave", () => {
    button.style.opacity = "0.5";
  });

  let currentSession: XRSession | null = null;

  const onSessionEnded = (): void => {
    currentSession?.removeEventListener("end", onSessionEnded);
    currentSession = null;
    button.textContent = enterLabel;
  };

  const onSessionStarted = async (session: XRSession): Promise<void> => {
    session.addEventListener("end", onSessionEnded);
    await renderer.xr.setSession(session);
    currentSession = session;
    button.textContent = exitLabel;
  };

  button.addEventListener("click", () => {
    if (currentSession) {
      void currentSession.end();
      return;
    }
    // "webgpu" is required by the WebGPU backend; floor/layers mirror the stock VRButton.
    const sessionInit: XRSessionInit = {
      requiredFeatures: ["webgpu"],
      optionalFeatures: ["local-floor", "bounded-floor", "layers"],
    };
    void xr
      .requestSession(mode, sessionInit)
      .then(onSessionStarted)
      .catch((err) => {
        console.warn("[xr] session request failed", err);
      });
  });

  return {
    element: button,
    isPassthrough(): boolean {
      const session = renderer.xr.getSession();
      return session !== null && PASSTHROUGH_MODES.has(session.environmentBlendMode);
    },
  };
}
