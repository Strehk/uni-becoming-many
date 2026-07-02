import { type ControlOrientation, connectHost } from "./icaros/index.ts";
import { createPlayer } from "./player/index.ts";
import { createRenderer } from "./renderer/index.ts";
import { createSenses } from "./senses/index.ts";
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

createSenses(renderer.canvas);

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

// Fly: each frame, steer the player by the latest controller orientation, then let it
// advance forward at its constant speed.
renderer.start((dtSeconds) => player.update(dtSeconds, orientation));
