// ── Becoming Many — Synth integration (host side) ──────────────
//
// The Tone.js synthesizer (SynthModulHandy) lives UNCHANGED — UI, UX, patch
// cables, sound recipes — as a vendored app under `src/synth/vendor/`, served on
// its own page (`/synth.html`). That page runs standalone on a phone, or inside
// the experience as the fullscreen iframe overlay this module hosts (key **M**).
//
// The iframe is same-origin, so the bridge talks to it directly:
//
//   - every frame it pushes a `__bmFrame` object into the synth window: player
//     pose (for the spatial listener), the six flight values (0..1), the nine
//     sense intensities + unrest/intensity/quality, and the scent-source anchor
//     positions published on the signal substrate. The vendored "Signale" rack card
//     exposes them as patchable sources — the demo flight world it replaces is gone.
//   - the synth app preloads its default sense layers after audio unlock. Each
//     frame this bridge mirrors visual sense intensities onto every matching
//     synth layer of the same kind, so duplicate synth layers follow the same
//     signal contract automatically.
//
// Audio unlock stays the synth's own veil (a tap inside the iframe) — iOS-safe.

import { SENSE_ORDER, SENSE_SYNTH_MAP } from "../senses/ids.ts";
import { signals } from "../signals/index.ts";

const STYLE_ID = "synth-overlay-styles";

export interface SynthOverlayOptions {
  /** Ground height under (x,z) — for the altitude/proximity params. */
  ground(x: number, z: number): number | null;
  /** Camera world matrix elements provider (yaw/pitch extraction). */
  cameraMatrix(): ArrayLike<number>;
}

export interface SynthOverlay {
  /** Push the per-frame signal packet + run the sense→layer coupling. */
  update(dt: number): void;
  setOpen(open: boolean): void;
  onOpenChange(cb: (open: boolean) => void): () => void;
  toggle(): void;
  dispose(): void;
}

interface SynthLayerInfo {
  layer: { sense: { id: string } };
}
interface SynthApp {
  layers: SynthLayerInfo[];
  addLayer(id: string): void;
  ensureBecomingManyDefaults?: () => void;
  syncSenseLayers?: (id: string, value: number) => void;
  /** Host-driven per-frame pump used WHILE the drawer is closed — the iframe is
   *  display:none then, so its own rAF (and the sense-gate loop) is paused. */
  pumpFromHost?: () => void;
}
interface SynthEngine {
  isAudible?: () => boolean;
  /** true once start() fully ran (incl. Tone.Transport.start()); the unlock loop
   *  must wait on THIS, not isAudible() — the context can be "running" while the
   *  transport is still stopped and every loop/melody layer stays silent. */
  isStarted?: () => boolean;
}
interface SynthWindow {
  __bmFrame?: Record<string, unknown>;
  bmApp?: SynthApp;
  bmEngine?: SynthEngine;
  bmStartAudio?: () => void;
}

/** Narrow an iframe's contentWindow to the synth window shape (same-origin). */
function isSynthWindow(w: unknown): w is SynthWindow {
  return typeof w === "object" && w !== null && "document" in w;
}
function synthWindow(iframe: HTMLIFrameElement | null): SynthWindow | null {
  const w: unknown = iframe?.contentWindow;
  return isSynthWindow(w) ? w : null;
}

function isSynthApp(value: unknown): value is SynthApp {
  return (
    typeof value === "object" &&
    value !== null &&
    "addLayer" in value &&
    typeof value.addLayer === "function" &&
    "layers" in value &&
    Array.isArray(value.layers)
  );
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function createSynthOverlay(options: SynthOverlayOptions): SynthOverlay {
  injectStyles();

  // ── overlay DOM (iframe created lazily on first open) ──
  const tab = document.createElement("button");
  tab.className = "synth-tab";
  tab.title = "Synthesizer (M)";
  tab.textContent = "♪";

  const drawer = document.createElement("div");
  drawer.className = "synth-drawer";
  const head = document.createElement("div");
  head.className = "synth-head";
  head.innerHTML = "<span>SYNTH · drone organ</span>";
  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "Schließen (M)";
  head.append(close);
  const frameWrap = document.createElement("div");
  frameWrap.className = "synth-frame";
  drawer.append(head, frameWrap);
  document.body.append(tab, drawer);

  let iframe: HTMLIFrameElement | null = null;
  let open = false;
  const openListeners = new Set<(open: boolean) => void>();

  const ensureIframe = (): void => {
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.src = "/synth.html";
      iframe.allow = "autoplay";
      frameWrap.append(iframe);
    }
  };

  const setOpen = (next: boolean): void => {
    open = next;
    drawer.classList.toggle("open", open);
    tab.style.display = open ? "none" : "";
    ensureIframe();
    if (open) {
      synthWindow(iframe)?.bmStartAudio?.();
    }
    for (const cb of openListeners) {
      cb(open);
    }
  };
  ensureIframe();

  tab.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));

  // ── autoplay unlock ──
  // The synth iframe carries its own AudioContext, which the browser keeps
  // suspended until a user gesture. The iframe's own pointerdown unlock never
  // fires while the drawer is hidden (display:none), so in the main experience —
  // and on the config page — the organ stays silent until the drawer is opened.
  // Forward the first parent-window gesture into the iframe instead, and keep
  // retrying until audio is genuinely running: a single blocked attempt (iframe
  // not yet loaded, a gesture lost to a race) must not leave the synth mute.
  const unlockEvents = ["pointerdown", "keydown", "touchend"] as const;
  const tryUnlockAudio = (): void => {
    const win = synthWindow(iframe);
    if (!win) {
      return;
    }
    // Only stop forwarding once the transport is genuinely started — a merely
    // "running" context (isAudible) leaves the loop/melody layers silent because
    // engine.start() → Tone.Transport.start() was never reached.
    if (win.bmEngine?.isStarted?.() && win.bmEngine?.isAudible?.()) {
      detachUnlock();
      return;
    }
    win.bmStartAudio?.();
  };
  const detachUnlock = (): void => {
    for (const ev of unlockEvents) {
      window.removeEventListener(ev, tryUnlockAudio);
    }
  };
  for (const ev of unlockEvents) {
    window.addEventListener(ev, tryUnlockAudio);
  }

  const isTyping = (): boolean => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "m" && event.key !== "M") {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping()) {
      return;
    }
    event.preventDefault();
    setOpen(!open);
  };
  window.addEventListener("keydown", onKeyDown);

  // ── per-frame signal packet ──
  const pose = signals.playerPose.peek();
  let prevX = pose.x;
  let prevZ = pose.z;
  let prevYaw = 0;
  let smoothedTempo = 0.5;
  let smoothedKurve = 0.5;

  let defaultsRequested = false;

  interface SenseFrame {
    unrest: number;
    intensity: number;
    quality: number;
    [key: string]: number;
  }
  const senseFrame: SenseFrame = { unrest: 0, intensity: 0, quality: 0 };
  const params = {
    hoehe: 0.5,
    tempo: 0.5,
    kurve: 0.5,
    neigung: 0.5,
    naehe: 0,
    richtung: 0,
  };

  const update = (dt: number): void => {
    const win = synthWindow(iframe);
    if (!win) {
      return;
    }

    // Camera orientation: forward = −Z column of the world matrix.
    const m = options.cameraMatrix();
    const fx = -(m[8] ?? 0);
    const fy = -(m[9] ?? 0);
    const fz = -(m[10] ?? 1);
    const yaw = Math.atan2(fx, fz);
    const pitch = Math.asin(Math.min(1, Math.max(-1, fy)));

    // Flight params 0..1 from the emergent state.
    const ground = options.ground(pose.x, pose.z);
    const altitude = ground === null ? 20 : pose.y - ground;
    params.hoehe = clamp01(altitude / 60);
    params.naehe = clamp01(1 - altitude / 30);
    params.neigung = clamp01(0.5 + pitch / Math.PI);
    params.richtung = (yaw / (Math.PI * 2) + 1) % 1;

    if (dt > 0) {
      const dx = pose.x - prevX;
      const dz = pose.z - prevZ;
      const speed = Math.sqrt(dx * dx + dz * dz) / dt;
      smoothedTempo += (clamp01(speed / 14) - smoothedTempo) * Math.min(1, dt * 3);
      let yawRate = (yaw - prevYaw) / dt;
      if (yawRate > Math.PI) yawRate -= Math.PI * 2;
      if (yawRate < -Math.PI) yawRate += Math.PI * 2;
      smoothedKurve += (clamp01(0.5 + yawRate / 2) - smoothedKurve) * Math.min(1, dt * 3);
    }
    params.tempo = smoothedTempo;
    params.kurve = smoothedKurve;
    prevX = pose.x;
    prevZ = pose.z;
    prevYaw = yaw;

    // Sense intensities + authored macros as patchable sources.
    for (const id of SENSE_ORDER) {
      senseFrame[`sinn_${id}`] = signals.sense[id].peek();
    }
    senseFrame.unrest = signals.unrest.peek();
    senseFrame.intensity = signals.intensity.peek();
    senseFrame.quality = signals.controlQuality.peek();

    win.__bmFrame = {
      t: signals.time.peek(),
      pose: { x: pose.x, y: pose.y, z: pose.z, yaw, pitch },
      params,
      senses: senseFrame,
      anchors: signals.scentAnchors.peek(),
    };

    // Sense → layer coupling: every synth layer of a mapped kind follows the visual
    // sense signal. This also covers duplicate layers added later in the synth UI.
    const app: unknown = win.bmApp;
    if (isSynthApp(app)) {
      if (!defaultsRequested) {
        defaultsRequested = true;
        app.ensureBecomingManyDefaults?.();
      }
      for (const id of SENSE_ORDER) {
        const synthId = SENSE_SYNTH_MAP[id];
        if (!synthId) {
          continue;
        }
        const value = signals.sense[id].peek();
        if (app.syncSenseLayers) {
          app.syncSenseLayers(synthId, value);
        } else if (value > 0 && !app.layers.some((info) => info.layer.sense.id === synthId)) {
          app.addLayer(synthId);
        }
      }
      // While the drawer is CLOSED the iframe is display:none, so its own
      // requestAnimationFrame (and with it the sense-gate loop in frame()) is
      // paused — gated layers would only start when the tab is first opened.
      // Drive the gate + sense-modulation from the host loop instead. When the
      // drawer is open, the iframe's frame() owns this, so we skip it here.
      if (!open) {
        app.pumpFromHost?.();
      }
    }
  };

  return {
    update,
    setOpen,
    onOpenChange(cb: (open: boolean) => void): () => void {
      openListeners.add(cb);
      cb(open);
      return () => {
        openListeners.delete(cb);
      };
    },
    toggle(): void {
      setOpen(!open);
    },
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      detachUnlock();
      openListeners.clear();
      tab.remove();
      drawer.remove();
    },
  };
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.synth-tab {
  position: fixed; bottom: 16px; right: 16px; z-index: 9998;
  width: 44px; height: 44px; border-radius: 50%;
  background: rgba(24,24,27,0.92); border: 1px solid rgba(255,255,255,0.16);
  color: #7fd4e8; font-size: 18px; cursor: pointer; opacity: 0.7; transition: opacity 0.15s;
}
.synth-tab:hover { opacity: 1; }

.synth-drawer {
  position: fixed; inset: 0; z-index: 10000; display: none; flex-direction: column;
  background: #07090d;
}
.synth-drawer.open { display: flex; }
.synth-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; color: #7fd4e8; background: #0a0d12;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  letter-spacing: 0.08em;
}
.synth-head button {
  background: none; border: 1px solid rgba(255,255,255,0.16); border-radius: 3px;
  color: #a1a1aa; cursor: pointer; font-size: 13px; padding: 2px 8px;
}
.synth-head button:hover { color: #f87171; }
.synth-frame { flex: 1; }
.synth-frame iframe { width: 100%; height: 100%; border: 0; display: block; }
`;
