import { time } from "three/tsl";
import { createAtmosphere } from "./atmosphere/index.ts";
import { SoundBus, SoundDirector } from "./audio/index.ts";
import { createDevConsole } from "./dev-console/index.ts";
import { type ControlOrientation, connectHost } from "./icaros/index.ts";
import { createLife } from "./life/index.ts";
import { createMinimap } from "./minimap/index.ts";
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

// ── The sense state machine ─────────────────────────────────────────────────
// Keys 1–7 / [ ] write `signals.activeSense`; the manager eases the view uniforms toward it and
// publishes `signals.senseProgress`. Created BEFORE the world so its live uniforms can be handed to
// every material that should belong to the current sense (terrain, water, flora).
const senses = createSenses({ start: "normal" });
window.addEventListener("pagehide", () => senses.dispose());

// Life: instanced flora that streams with the terrain. Async — the species GLBs must
// land before a chunk can be populated. It shares the sense uniforms with the world.
const life = await createLife({ scene: renderer.scene, uniforms: senses.uniforms });
window.addEventListener("pagehide", () => life.dispose());

// Atmosphere: a field of stationary dust motes hanging in the air. As the player flies
// through, motion parallax makes self-motion pop. A pure signal consumer (reads
// playerPose + time); shares the sense uniforms so it fades at the same view edge.
const atmosphere = createAtmosphere({ scene: renderer.scene, uniforms: senses.uniforms });
window.addEventListener("pagehide", () => atmosphere.dispose());

// Streaming terrain: a chunked, worker-generated world that loads around the player.
// Sharing `senses.uniforms` is what makes a sense switch restyle terrain and flora
// together; the chunk hooks are what let life grow on it and be freed with it.
const { world } = createTerrainWorld({
  scene: renderer.scene,
  uTime: time,
  uniforms: senses.uniforms,
  onChunkBuilt: (info) => life.onChunkBuilt(info),
  onChunkDisposed: (cell) => life.onChunkDisposed(cell),
});

// Player: carries the renderer's camera and flies forward at a constant speed. The
// `floor` callback keeps the rig a little above the streamed ground so it can never
// dive through the terrain; it returns null over not-yet-loaded chunks (no clamp).
const player = createPlayer(renderer.camera, {
  speed: 6,
  clearance: 4,
  floor: (x, z) => world.groundHeightAt(x, z),
});
renderer.scene.add(player.rig);

// ── Theatre.js: authored envelopes, slaved to the clock ─────────────────────
// Dev loads @theatre/studio (dynamic import ⇒ out of the prod bundle); prod loads state.json.
const theatre = await initTheatre();
window.addEventListener("pagehide", () => theatre.dispose());

// ── Audio director on the bus ───────────────────────────────────────────────
// Cues decouple *what* plays from *why*: an `event` cue plays whenever anyone emits `cue:<id>`;
// a `time` cue is scheduled on the clock and obeys pause/seek/timeScale. Asset URLs are
// placeholders until the sound pipeline lands — a missing file warns once and is otherwise inert.
const soundBus = new SoundBus();
const director = new SoundDirector(soundBus, clock, bus);
director.cue({ id: "chirp", src: "/audio/chirp.ogg", gain: 0.7, trigger: { kind: "event" } });
window.addEventListener("pagehide", () => director.dispose());

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

// Biome minimap: a top-down chunk/biome debug overlay hosted inside the C console.
// Heading = camera forward on XZ, read from the camera's world matrix (forward = −Z
// column = (−m8, −m9, −m10)) so no extra three import is needed here.
const minimap = createMinimap(world.biomeSource, () => {
  const m = renderer.camera.matrixWorld.elements;
  return { x: pose.x, z: pose.z, heading: Math.atan2(-(m[8] ?? 0), m[10] ?? 1) };
});
devConsole.addSection(minimap.element);
const detachMinimap = devConsole.onOpenChange((open) => minimap.setActive(open));
window.addEventListener("pagehide", () => {
  detachMinimap();
  minimap.dispose();
});

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

  // ── CONSUME ──
  world.update(pose.x, pose.z); // 6. stream chunks around the player
  life.update(dtSeconds); // 7. pump time / unrest / intensity / sense into the flora uniforms
  atmosphere.update(dtSeconds); // 8. pump player pose + virtual clock into the dust uniforms
});

// Release worker + GPU resources when the page goes away.
window.addEventListener("pagehide", () => world.dispose());
