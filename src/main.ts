import { time } from "three/tsl";
import { SoundBus, SoundDirector } from "./audio/index.ts";
import { createBeacon } from "./behaviour/index.ts";
import { createDevConsole } from "./dev-console/index.ts";
import { type ControlOrientation, connectHost } from "./icaros/index.ts";
import { createPlayer } from "./player/index.ts";
import { createKeyboardControls } from "./player/keyboard-controls.ts";
import { createRenderer } from "./renderer/index.ts";
import { createSenses } from "./senses/index.ts";
import { bus, signals } from "./signals/index.ts";
import { createTerrainWorld } from "./terrain/index.ts";
import { initTheatre, pumpAuthored } from "./theatre/index.ts";
import { Clock } from "./time/clock.ts";
import { createTransport } from "./time/transport.ts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app mount point not found");
}

// `createRenderer` is async — WebGPU must finish `init()` before the first frame.
const renderer = await createRenderer();
app.append(renderer.canvas);
document.body.append(renderer.vrButton); // "Enter VR" overlay

// ── The time spine ──────────────────────────────────────────────────────────
// The single authority on time. The frame loop feeds it real dt; everything animated (authored or
// emergent) advances through it, so pause/seek/timeScale govern the whole world. See docs §2.
const clock = new Clock();
// Keyboard transport for authoring/debugging: K pause, J/L seek, ,/. timeScale, 0 reset.
const transport = createTransport(clock);
window.addEventListener("pagehide", () => transport.dispose());

// Player: carries the renderer's camera and flies forward at a constant speed.
const player = createPlayer(renderer.camera, { speed: 6 });
renderer.scene.add(player.rig);

// Streaming terrain: a chunked, worker-generated world that loads around the player.
const { world } = createTerrainWorld({ scene: renderer.scene, uTime: time });

// ── The sense state machine ─────────────────────────────────────────────────
// Keys 1–7 / [ ] write `signals.activeSense`; the manager eases the view uniforms toward it and
// publishes `signals.senseProgress`. Bind `senses.uniforms` into the terrain material to make the
// transitions drive shading (follow-up wiring).
const senses = createSenses({ start: "normal" });
window.addEventListener("pagehide", () => senses.dispose());

// ── Theatre.js: authored envelopes, slaved to the clock ─────────────────────
// Dev loads @theatre/studio (dynamic import ⇒ out of the prod bundle); prod loads state.json.
const theatre = await initTheatre();
window.addEventListener("pagehide", () => theatre.dispose());

// ── Audio director on the bus ───────────────────────────────────────────────
// Cues decouple *what* plays from *why*: an `event` cue plays whenever anyone emits `cue:<id>`
// (the beacon below emits `cue:chirp`); a `time` cue is scheduled on the clock and obeys
// pause/seek/timeScale. Asset URLs are placeholders until the sound pipeline lands — a missing
// file warns once and is otherwise inert.
const soundBus = new SoundBus();
const director = new SoundDirector(soundBus, clock, bus);
director.cue({ id: "chirp", src: "/audio/chirp.ogg", gain: 0.7, trigger: { kind: "event" } });
window.addEventListener("pagehide", () => director.dispose());

// ── An emergent object instance (the modular payoff) ────────────────────────
// Reads signals, follows the active sense, and emits its own `cue:chirp` when the player nears it
// in echo sense — zero central wiring. Placed a short flight ahead of the spawn point.
const beacon = createBeacon(renderer.scene, {
  position: { x: 0, y: 1.6, z: -60 },
  activeSense: "echo",
});
window.addEventListener("pagehide", () => beacon.dispose());

// Dev console: press "C" for a live FPS / render-stats overlay.
const devConsole = createDevConsole(renderer.instance, { label: "becoming-many" });
window.addEventListener("pagehide", () => devConsole.dispose());

// Debug controls: WASD / arrows to steer, Shift for 2× speed, Space to hold position.
const keyboard = createKeyboardControls();
window.addEventListener("pagehide", () => keyboard.dispose());

// --- ICAROS host connection -------------------------------------------------
const hostOrigin =
  new URLSearchParams(window.location.search).get("host") ??
  import.meta.env.VITE_ICAROS_HOST ??
  "https://localhost:5183";

// Latest validated controller orientation; steers the player each frame.
const orientation: { pitch: number; roll: number; quality: number } = {
  pitch: 0,
  roll: 0,
  quality: 0,
};

const applyOrientation = (next: ControlOrientation): void => {
  orientation.pitch = next.pitch;
  orientation.roll = next.roll;
  orientation.quality = next.quality;
  // Publish control quality onto the substrate so anything can react (e.g. a "signal lost" cue).
  signals.controlQuality.value = next.quality;
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
window.addEventListener("pagehide", disconnectHost);

// Live handle to the mutated-in-place pose signal — the player writes into it each frame.
const pose = signals.playerPose.peek();

// ── Frame loop — the §5 ordering: PRODUCE → REACT → CONSUME ─────────────────
renderer.start((dtSeconds) => {
  // ── PRODUCE ──
  clock.advance(dtSeconds); // 1. spine advances; time-cues fire
  signals.time.value = clock.now; // publish time onto the substrate (the one clock→signals bridge)
  if (clock.running) {
    theatre.setPosition(clock.now); // 2. slave Theatre's playhead to the spine (Studio owns it when paused)
  }
  pumpAuthored(theatre.arc); // 3. authored Theatre values → authored signals (the one-writer bridge)

  keyboard.update(dtSeconds); // 4. input → player → emergent signals
  const { locomotion } = keyboard;
  player.look(locomotion.pitch);
  player.update(dtSeconds, {
    pitch: keyboard.steering ? 0 : orientation.pitch,
    roll: keyboard.steering ? locomotion.turn : orientation.roll,
    throttle: locomotion.throttle,
    paused: locomotion.paused,
  });
  // Publish the player's world position (mutated in place — hot-path peek elsewhere).
  pose.x = player.rig.position.x;
  pose.y = player.rig.position.y;
  pose.z = player.rig.position.z;

  senses.update(dtSeconds); // writes senseProgress; eases the view uniforms

  // ── REACT ──
  bus.tick(); // 5. evaluate `when` crossings (proximity / sense / threshold) → emit
  beacon.update(dtSeconds); // emergent object reads signals + bus, decides locally, may emit cues

  // ── CONSUME ──
  world.update(pose.x, pose.z); // 6. stream chunks around the player
});

// Release worker + GPU resources when the page goes away.
window.addEventListener("pagehide", () => world.dispose());
