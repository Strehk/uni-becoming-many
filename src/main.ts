import { time } from "three/tsl";
import { createDevConsole } from "./dev-console/index.ts";
import { type ControlOrientation, connectHost } from "./icaros/index.ts";
import { createPlayer } from "./player/index.ts";
import { createKeyboardControls } from "./player/keyboard-controls.ts";
import { createRenderer } from "./renderer/index.ts";
import { createSenses } from "./senses/index.ts";
import { createTerrainWorld } from "./terrain/index.ts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app mount point not found");
}

// `createRenderer` is async — WebGPU must finish `init()` before the first frame.
const renderer = await createRenderer();
app.append(renderer.canvas);
document.body.append(renderer.vrButton); // "Enter VR" overlay

// Player: carries the renderer's camera and flies forward at a constant speed.
const player = createPlayer(renderer.camera, { speed: 6 });
renderer.scene.add(player.rig);

// Perception layer (pointer over the canvas). Passed to the terrain so the sense
// look (view bubble + edge glow) tracks attention live.
const senses = createSenses(renderer.canvas);

// Streaming terrain: a chunked, worker-generated world that loads around the
// player. `world.group` is added to the scene internally; we drive it each frame
// with the rig's world XZ (see the loop below). The default `worldgen` provider
// runs the two-WFC-pass pipeline (biomes + landforms) + hydrology in a worker.
const { world } = createTerrainWorld({ scene: renderer.scene, uTime: time, senses });

// Dev console: press "C" for a live FPS / render-stats overlay (frame-time graph, draw calls,
// GPU resources, timing). Purely diagnostic; wraps the renderer's `render` for GPU timing.
const devConsole = createDevConsole(renderer.instance, { label: "becoming-many" });
window.addEventListener("pagehide", () => devConsole.dispose());

// Debug controls: WASD / arrows to steer, Shift for 2× speed, Space to hold position.
// Overrides the ICAROS stream while any steering key is held (see the frame loop below).
const keyboard = createKeyboardControls();
window.addEventListener("pagehide", () => keyboard.dispose());

// --- ICAROS host connection -------------------------------------------------
// Host origin resolution, most-specific first: `?host=https://<host>:5183` query param →
// the `VITE_ICAROS_HOST` env baked in at dev-server start (`bun start <ip>`, see
// scripts/start.ts) → localhost. This lets the headset open the plain dev URL while still
// allowing a per-load override. `clientUrl` is this page's own HTTPS origin — the address
// the host redirects to on launch, so it must be reachable by the headset (serve dev with
// `bun run dev` / `bun start <ip>`, both `vite --host`, to expose the LAN IP over HTTPS).
const hostOrigin =
  new URLSearchParams(window.location.search).get("host") ??
  import.meta.env.VITE_ICAROS_HOST ??
  "https://localhost:5183";

// Latest validated controller orientation; steers the player each frame (see the loop
// below). Updated in place by `applyOrientation`, so it stays at neutral until the host
// streams data — the player then flies straight and level.
const orientation: { pitch: number; roll: number; quality: number } = {
  pitch: 0,
  roll: 0,
  quality: 0,
};

const applyOrientation = (next: ControlOrientation): void => {
  orientation.pitch = next.pitch;
  orientation.roll = next.roll;
  orientation.quality = next.quality;
};

const disconnectHost = connectHost({
  hostOrigin,
  clientId: `becoming-many-${crypto.randomUUID()}`,
  experienceId: "becoming-many",
  title: "becoming-many",
  clientUrl: window.location.href,
  onOrientation: applyOrientation,
  onRegistered: () => console.info(`[icaros] registered with host ${hostOrigin}`),
  onRejected: (reason) => console.warn(`[icaros] host rejected client: ${reason}`),
});

// Cleanup: stop the heartbeat and close both sockets when the page goes away.
window.addEventListener("pagehide", disconnectHost);

// Fly: each frame the keyboard's `turn` (A/D) drives the player's heading so the course curves
// and persists — you can come about — while its `pitch` (W/S) is a spring-centered look that
// tilts travel up/down and re-levels on release. Both feed in only while a debug key is held
// (ICAROS steers otherwise). Throttle (Shift) and hold (Space) always come from the keyboard.
// Its `update` advances the springs; read its state right after.
renderer.start((dtSeconds) => {
  keyboard.update(dtSeconds);
  const { locomotion } = keyboard;
  player.look(locomotion.pitch);
  player.update(dtSeconds, {
    pitch: keyboard.steering ? 0 : orientation.pitch,
    roll: keyboard.steering ? locomotion.turn : orientation.roll,
    throttle: locomotion.throttle,
    paused: locomotion.paused,
  });
  // Stream chunks around the player's world position (rig XZ).
  world.update(player.rig.position.x, player.rig.position.z);
});

// Release worker + GPU resources when the page goes away.
window.addEventListener("pagehide", () => world.dispose());
