import { time } from "three/tsl";
import { createAtmosphere } from "./atmosphere/index.ts";
import { SoundBus, SoundDirector } from "./audio/index.ts";
import { createCreatures } from "./creatures/index.ts";
import { createDevConsole } from "./dev-console/index.ts";
import { createSaveTuningControls } from "./dev-console/save-tuning.ts";
import { createSenseControls } from "./dev-console/sense-controls.ts";
import { createWorldControls } from "./dev-console/world-controls.ts";
import {
  type ExperienceConfig,
  loadExperienceConfig,
  saveExperienceConfig,
} from "./experience/config.ts";
import { createInterfaceModeController } from "./experience/interface-mode.ts";
import { createStartMenu } from "./experience/start-menu.ts";
import { type Grass, createGrass } from "./grass/index.ts";
import { type ControlOrientation, connectHost } from "./icaros/index.ts";
import { createLife } from "./life/index.ts";
import { createMinimap } from "./minimap/index.ts";
import { createPlayer } from "./player/index.ts";
import { createKeyboardControls } from "./player/keyboard-controls.ts";
import { createRenderer } from "./renderer/index.ts";
import { createDuftSense } from "./senses/duft/index.ts";
import { SENSE_ORDER, createSenses } from "./senses/index.ts";
import { createMagnetfeldSense } from "./senses/magnetfeld/index.ts";
import { createMotionSense } from "./senses/motion/index.ts";
import { createNetzwerkSense } from "./senses/netzwerk/index.ts";
import { createRundumSense } from "./senses/rundum/index.ts";
import { loadSenseState, savedSenseState, serializeSenseState } from "./senses/state.ts";
import { bus, signals } from "./signals/index.ts";
import { createSynthOverlay } from "./synth/index.ts";
import { createTerrainWorld } from "./terrain/index.ts";
import { loadTerrainState, savedTerrainState, serializeTerrainState } from "./terrain/state.ts";
import { initTheatre, pumpAuthored } from "./theatre/index.ts";
import { Clock } from "./time/clock.ts";
import { createTransport } from "./time/transport.ts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app mount point not found");
}
const searchParams = new URLSearchParams(window.location.search);
const useTheatreStudio = searchParams.get("studio") === "1";
const showDebugUi = searchParams.get("debug") === "1";

// `createRenderer` is async — WebGPU must finish `init()` before the first frame.
const renderer = await createRenderer();
app.append(renderer.canvas);
// Same-origin synth iframe reads this for the FlightModule live preview.
(window as Window & { __bmFlightCanvas?: HTMLCanvasElement }).__bmFlightCanvas = renderer.canvas;
document.body.append(renderer.vrButton); // "Enter VR" overlay

// ── The time spine ──────────────────────────────────────────────────────────
// The single authority on time. The frame loop feeds it real dt; everything animated (authored or
// emergent) advances through it, so pause/seek/timeScale govern the whole world. See docs §2.
const clock = new Clock();
let experienceConfig: ExperienceConfig = loadExperienceConfig();
if (!useTheatreStudio) {
  clock.pause();
}
// Keyboard transport for authoring/debugging: Space/K pause, J/L seek, ,/. timeScale, Home reset.
const transport = createTransport(clock);
window.addEventListener("pagehide", () => transport.dispose());

// ── The sense layer system ──────────────────────────────────────────────────
// Keys 1–9 toggle the nine sense layers (0 = all off) via bus commands; the SenseDirector
// writes `signals.sense[id]`, and the atmosphere eases toward the dominant layer's profile.
// The same signals are driven by Theatre (authority-gated) and the dev-console sense UI.
const senses = createSenses(bus);
window.addEventListener("pagehide", () => senses.dispose());

// The void's backdrop follows the atmosphere: the empty sky is the very colour the
// terrain dissolves into — pale white when no sense is active (so the base state reads
// as one uniform white world), near-black under echo, violet under UV, etc. This is the
// live `fogColor` the SenseManager lerps, so the background transitions with the senses.
renderer.scene.background = senses.uniforms.fogColor.value;

// Life: instanced flora that streams with the terrain, wired to the sense substrate.
// It shares the senses' uniforms so it reveals/fades with the world and reads
// `activeSense` for its bioluminescence. Gated on a sense being active (the void
// must stay empty) by toggling `life.group.visible` in the frame loop.
const life = await createLife({
  scene: renderer.scene,
  uniforms: senses.uniforms,
  layers: senses.shader.compositor,
});
window.addEventListener("pagehide", () => life.dispose());

// Atmosphere: a field of stationary dust motes hanging in the air. As the player flies
// through, motion parallax makes self-motion pop. A pure signal consumer (reads
// playerPose + time); shares the sense uniforms so it fades at the same view edge.
const atmosphere = createAtmosphere({ scene: renderer.scene, uniforms: senses.uniforms });
window.addEventListener("pagehide", () => atmosphere.dispose());

// Streaming terrain: a chunked, worker-generated world that loads around the player.
// It shares the senses' atmosphere uniforms (sense transitions restyle the world live),
// composites the four shader-sense colour layers over the biome albedo, and fires the
// chunk hooks that let flora grow on each chunk and be freed with it.
// GPU grass shares the terrain's chunk hooks (fields cache) and sense look. Declared
// before the world so its `onChunkBuilt`/`onChunkDisposed` can fan out alongside life's;
// assigned just after (it needs `world.groundHeightAt` for the CPU→GPU height bridge).
// biome-ignore lint/style/useConst: forward-referenced by the terrain chunk hooks below before assignment
let grass: Grass | undefined;
const { world } = createTerrainWorld({
  scene: renderer.scene,
  uTime: time,
  uniforms: senses.uniforms,
  layers: senses.shader.compositor,
  onChunkBuilt: (info) => {
    life.onChunkBuilt(info);
    grass?.onChunkBuilt(info);
  },
  onChunkDisposed: (cell) => {
    life.onChunkDisposed(cell);
    grass?.onChunkDisposed(cell);
  },
});

// Compute-driven grass: a camera-centred field of bezier blades on grass-fitting biomes,
// hidden in the void and revealed with the senses like the flora (see src/grass/).
grass = createGrass({
  scene: renderer.scene,
  renderer: renderer.instance,
  camera: renderer.camera,
  uniforms: senses.uniforms,
  layers: senses.shader.compositor,
  groundHeightAt: (x, z) => world.groundHeightAt(x, z),
});
window.addEventListener("pagehide", () => grass?.dispose());

// Restore the committed worldgen tuning (provider / config / param overrides) before
// chunks stream — the dev-console World panel then opens on these values.
loadTerrainState(savedTerrainState, world);

// Magnetfeld sense: the sky dome showing the geomagnetic field (9 blendable modes),
// fading with `signals.sense.magnetfeld` and following the player.
const magnetfeld = createMagnetfeldSense(renderer.scene, bus);
window.addEventListener("pagehide", () => magnetfeld.dispose());

// Duft sense: GPU scent particles anchored to the terrain around the player,
// gated by `signals.sense.duft` (no compute while faded out).
const duft = createDuftSense(renderer.scene, bus, renderer.instance, (x, z) =>
  world.groundHeightAt(x, z),
);
window.addEventListener("pagehide", () => duft.dispose());

// Creatures substrate: the boids bird swarm + mushroom spawn points that the
// netzwerk / motion senses perceive. Plain world state, no sense logic.
const creatures = createCreatures(renderer.scene, bus, (x, z) => world.groundHeightAt(x, z));
window.addEventListener("pagehide", () => creatures.dispose());

// Netzwerk sense: swarm communication web between the birds + pulsing mycelium
// between the mushrooms, gated by `signals.sense.netzwerk`.
const netzwerk = createNetzwerkSense(renderer.scene, bus, creatures);
window.addEventListener("pagehide", () => netzwerk.dispose());

// Motion sense: particle trails from the birds' animated vertices. The bird meshes
// themselves stay hidden under EVERY sense (see the frame loop) — the trails are
// the only way the swarm becomes visible.
const motion = createMotionSense(renderer.scene, bus, creatures);
window.addEventListener("pagehide", () => motion.dispose());

// Rundum sense: the little-planet 360° projection replaces the render pass while
// `signals.sense.rundum` is up (skipped in XR — the headset owns projection).
const rundum = createRundumSense(renderer, bus);
window.addEventListener("pagehide", () => rundum.dispose());

// The five standalone sense descriptors (the shader senses serialize themselves).
const senseModules = [
  magnetfeld.controls,
  duft.controls,
  netzwerk.controls,
  motion.controls,
  rundum.controls,
];

// Restore the committed sense look before the panels build: the shader senses'
// params/blend/order via the SenseSystem, the standalone senses' params over the
// bus. Applying now means the dev-console Sinne panel opens on these values.
loadSenseState(savedSenseState, { shader: senses.shader, bus });

// Synth overlay (key M): the vendored Tone.js drone organ in a same-origin iframe.
// The bridge pushes pose/flight/sense signals each frame and auto-adds the mapped
// synth layer when a sense first switches on (see src/synth/index.ts).
const synth = createSynthOverlay({
  ground: (x, z) => world.groundHeightAt(x, z),
  cameraMatrix: () => renderer.camera.matrixWorld.elements,
  anchors: creatures,
});
window.addEventListener("pagehide", () => synth.dispose());

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

// While the clock is paused, Studio owns Theatre's playhead — mirror its scrubbing back into the
// clock so resuming continues from where you scrubbed, instead of the clock yanking Theatre back to
// its old time. Guarded on `!clock.running` so the frame loop's own `setPosition` never echoes.
const offTheatrePosition = theatre.onPositionChange((seconds) => {
  if (!clock.running) {
    clock.seek(seconds);
  }
});
window.addEventListener("pagehide", offTheatrePosition);

if (import.meta.env.DEV) {
  (window as Window & { __bmDebug?: unknown }).__bmDebug = { clock, signals, theatre };
}

// ── Audio director on the bus ───────────────────────────────────────────────
// Cues decouple *what* plays from *why*: an `event` cue plays whenever anyone emits `cue:<id>`;
// a `time` cue is scheduled on the clock and obeys pause/seek/timeScale. Asset URLs are
// placeholders until the sound pipeline lands — a missing file warns once and is otherwise inert.
const soundBus = new SoundBus();
const director = new SoundDirector(soundBus, clock, bus);
director.cue({ id: "chirp", src: "/audio/chirp.ogg", gain: 0.7, trigger: { kind: "event" } });
// One unlock cue per sense: `bus.when` fires on the rising edge of each sense signal
// (Theatre or manual alike) and emits `cue:sense:<id>` — the director plays the clip
// once real audio assets land (missing files warn once and stay inert).
for (const senseId of SENSE_ORDER) {
  director.cue({
    id: `sense:${senseId}`,
    src: `/audio/sense-${senseId}.ogg`,
    gain: 0.8,
    trigger: { kind: "event" },
  });
  bus.when(
    signals.sense[senseId],
    (v) => v > 0,
    () => bus.emit(`cue:sense:${senseId}`),
  );
}
window.addEventListener("pagehide", () => director.dispose());

// Dev console: press "C" for a live FPS / render-stats overlay.
const devConsole = createDevConsole(renderer.instance, { label: "becoming-many" });
window.addEventListener("pagehide", () => devConsole.dispose());

const interfaceMode = createInterfaceModeController({
  devConsole,
  inspectorElement: renderer.inspectorElement,
  vrButton: renderer.vrButton,
  debugEnabled: showDebugUi,
  setSynthOpen: (open) => synth.setOpen(open),
  onSynthOpenChange: (cb) => synth.onOpenChange(cb),
});
window.addEventListener("pagehide", () => interfaceMode.dispose());

// Start/config menu: normal runs play the Theatre timeline. The config UI is an editor shell;
// the actual authored sense timeline remains Theatre's `arc.senses.*` tracks.
// Theatre Studio remains available via ?studio=1 for advanced timeline editing.
if (!useTheatreStudio) {
  const startMenu = createStartMenu({
    config: experienceConfig,
    onConfigure(next) {
      experienceConfig = next;
      saveExperienceConfig(next);
      signals.senseAuthority.value = "theatre";
      clock.pause();
      clock.reset();
      theatre.setPosition(0);
      signals.time.value = 0;
      interfaceMode.setMode("configure");
    },
    onConfigChange(next) {
      experienceConfig = next;
      saveExperienceConfig(next);
    },
    onTest(next) {
      experienceConfig = next;
      saveExperienceConfig(next);
      signals.senseAuthority.value = "theatre";
      clock.reset();
      theatre.setPosition(0);
      signals.time.value = 0;
      clock.resume();
      interfaceMode.setMode("configure");
    },
    onStart(next) {
      experienceConfig = next;
      saveExperienceConfig(next);
      signals.senseAuthority.value = "theatre";
      clock.reset();
      theatre.setPosition(0);
      signals.time.value = 0;
      clock.resume();
      interfaceMode.setMode("playback");
    },
  });
  window.addEventListener("pagehide", () => startMenu.dispose());
} else {
  signals.senseAuthority.value = "theatre";
  interfaceMode.setMode("configure");
}

// Shared sense controls: one card per sense layer (toggle / solo / intensity +
// module parameters from UI-agnostic descriptors). Everything runs over bus
// commands — the same channel as keys 1–9 and the Theatre-driven signals.
const senseControls = createSenseControls(bus, [
  ...senses.shader.controls().map((d) => ({ ...d, movable: true })),
  ...senseModules,
]);
devConsole.addSection(senseControls.element);
window.addEventListener("pagehide", () => senseControls.dispose());

// World controls: live terrain-generator sliders (provider + all GenParams) inside
// the C console. Edits rebuild the streamed world in place.
const worldControls = createWorldControls(world);
devConsole.addSection(worldControls.element);
window.addEventListener("pagehide", () => worldControls.dispose());

// Dev-only: export the live sense + world tuning as committed state.json files.
if (import.meta.env.DEV) {
  const saveTuning = createSaveTuningControls({
    serializeSenses: () => serializeSenseState(senses.shader, senseModules),
    serializeWorld: () => serializeTerrainState(world),
  });
  devConsole.addSection(saveTuning.element);
  window.addEventListener("pagehide", () => saveTuning.dispose());
}

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
// Tracks the clock's running state across frames so a pause can also halt Theatre's own playback.
let wasClockRunning = clock.running;
renderer.start((dtSeconds) => {
  // ── PRODUCE ──
  clock.advance(dtSeconds); // 1. spine advances; time-cues fire
  signals.time.value = clock.now; // publish time onto the substrate (the one clock→signals bridge)
  if (clock.running) {
    theatre.setPosition(clock.now); // 2. slave Theatre's playhead to the spine (Studio owns it when paused)
  } else if (wasClockRunning) {
    theatre.pauseSequence(); // clock just paused ⇒ also halt any Theatre self-playback (Studio's play)
  }
  wasClockRunning = clock.running;
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
  magnetfeld.update(dtSeconds); // sky dome fade + follow player + spine time
  duft.update(clock.delta); // scent field: fade, re-anchor, GPU sim (spine-scaled dt)
  creatures.update(clock.delta); // boids swarm + mushroom anchors (obey pause/timeScale)
  // The bird MESHES are never drawn: birds enter the picture only through the senses
  // that perceive them — `motion` draws their vertex trails, `netzwerk` its swarm web.
  // Their raw dark meshes would pollute every other view (e.g. echo's pure depth map).
  // The boids keep flying while hidden, so those senses read live positions/animation.
  creatures.setBirdsVisible(false);
  // Flora is perception-dependent: the white void must read as an empty uniform field,
  // so the flora stays hidden until a sense reveals the world. Dust, by contrast, hangs
  // in the air even in the void — a faint drift of motes so the white-out never reads as
  // a dead blank screen before the first sense comes up.
  const worldRevealed = signals.activeSense.peek() !== "none";
  life.group.visible = worldRevealed;
  netzwerk.update(clock.delta); // swarm web + mycelium (fade, rebuild, pulse)
  motion.update(clock.delta); // vertex-motion trails (spawn/fade ring buffer)
  synth.update(dtSeconds); // push the signal packet into the synth iframe

  // ── REACT ──
  bus.tick(); // 5. evaluate `when` crossings (proximity / sense / threshold) → emit

  // ── CONSUME ──
  world.update(pose.x, pose.z); // 6. stream chunks around the player
  life.update(dtSeconds); // 7. pump time / unrest / intensity / sense into the flora uniforms
  grass?.update(dtSeconds); // GPU grass: snap, repaint field texture, dispatch compute (void-gated)
  atmosphere.update(dtSeconds); // 8. pump player pose + virtual clock into the dust uniforms
});

// Release worker + GPU resources when the page goes away.
window.addEventListener("pagehide", () => world.dispose());
