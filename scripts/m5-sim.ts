#!/usr/bin/env bun
/**
 * A fake M5 controller. Speaks the firmware's device protocol at the bridge so the whole chain —
 * device socket, pipeline, browser stream, glider — can be flown without hardware on the desk.
 *
 * It also produces the cases that are awkward to trigger on a real rig on purpose: an extreme
 * reconnect, a single-frame jump across the range, and the mechanically tilted rest pose that
 * the auto-neutralizer is supposed to silence.
 *
 * Usage (with `bun run dev` running in another terminal):
 *
 *   bun scripts/m5-sim.ts                 # slow sine sweep on pitch and roll
 *   bun scripts/m5-sim.ts --rest          # hold the rig's rest pose (expect neutral after 5 s)
 *   bun scripts/m5-sim.ts --glitch        # sweep, but jump across the range every 5 s
 *   bun scripts/m5-sim.ts --button        # sweep, pressing the button once a second
 *   bun scripts/m5-sim.ts --host 192.168.1.50 --port 5184
 */
import { createBridgeStore } from "../bridge/state.ts";
import { DEFAULT_AUTO_NEUTRALIZER_CONFIG } from "../src/m5/pipeline/index.ts";

/** The firmware's orientation cadence — 20 Hz (`OrientationIntervalMs = 50`). */
const FRAME_INTERVAL_MS = 50;
const HEARTBEAT_INTERVAL_MS = 2_000;
/** Full-scale tilt in the pipeline. Sweeping to ±30° keeps clear of the safety clamp. */
const SWEEP_DEGREES = 30;
const SWEEP_PERIOD_MS = 8_000;
const GLITCH_INTERVAL_MS = 5_000;
const DEVICE_ID = "icaros-station-a-m5-sim";

type Options = Readonly<{
  host: string;
  port: number;
  mode: "sweep" | "rest";
  glitch: boolean;
  button: boolean;
}>;

const options = readOptions(Bun.argv.slice(2));
const token = process.env["M5_PAIRING_TOKEN"]?.trim() || createBridgeStore().readPairingToken();
const url = `ws://${options.host}:${options.port}/ws/device?pairing=${encodeURIComponent(token)}`;

console.log(`▶ m5-sim → ${url.replace(token, "…")}`);
console.log(
  `▶ mode: ${options.mode}${options.glitch ? " + glitch" : ""}${options.button ? " + button" : ""}\n`,
);

const socket = new WebSocket(url);
let frameTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let startedAt = 0;
let lastGlitchAt = 0;
let buttonPressed = false;

socket.addEventListener("open", () => {
  console.log("✓ connected — streaming orientation frames (Ctrl-C to stop)");
  startedAt = Date.now();
  lastGlitchAt = startedAt;

  send({
    type: "register",
    deviceId: DEVICE_ID,
    role: "controller",
    firmwareVersion: "0.0.0-simulator",
    capabilities: ["imu", "orientation", "button"],
  });

  frameTimer = setInterval(sendOrientation, FRAME_INTERVAL_MS);
  heartbeatTimer = setInterval(
    () => send({ type: "heartbeat", deviceId: DEVICE_ID, role: "controller", quality: 1 }),
    HEARTBEAT_INTERVAL_MS,
  );
});

socket.addEventListener("close", (event) => {
  stop();
  // A refused connection and a rejected pairing token both surface as 1006 with no reason, so
  // name both causes rather than guessing at one.
  console.error(`✗ socket closed (code ${event.code}). If it never opened, either:
    · nothing is listening on ${options.host}:${options.port} — is \`bun run dev\` running?
    · or the bridge rejected the pairing token — same .m5/ directory as the dev server?`);
  process.exit(1);
});

// The error event carries no usable detail here; the close handler above reports the cause.
socket.addEventListener("error", () => {});

process.on("SIGINT", () => {
  stop();
  socket.close();
  console.log("\n▶ stopped");
  process.exit(0);
});

function sendOrientation(): void {
  const elapsed = Date.now() - startedAt;
  const orientation = readPose(elapsed);

  if (options.button) {
    buttonPressed = Math.floor(elapsed / 1_000) % 2 === 0;
  }
  const wasPressed = buttonPressed;

  send({
    type: "orientation",
    deviceId: DEVICE_ID,
    role: "controller",
    pitch: orientation.pitch,
    roll: orientation.roll,
    quality: 1,
    buttonPressed: wasPressed,
    buttonDown: options.button && wasPressed && elapsed % 1_000 < FRAME_INTERVAL_MS,
    buttonUp: options.button && !wasPressed && elapsed % 1_000 < FRAME_INTERVAL_MS,
  });
}

function readPose(elapsed: number): { pitch: number; roll: number } {
  if (options.glitch && elapsed - (lastGlitchAt - startedAt) >= GLITCH_INTERVAL_MS) {
    lastGlitchAt = Date.now();
    console.log("  ↯ glitch frame (full-scale jump — the pipeline should flatten this)");
    return { pitch: 45, roll: -45 };
  }

  if (options.mode === "rest") {
    // The auto-neutralizer's rest pose, converted back into the degrees a device would report.
    return {
      pitch: DEFAULT_AUTO_NEUTRALIZER_CONFIG.restPitch * 45,
      roll: DEFAULT_AUTO_NEUTRALIZER_CONFIG.restRoll * 45,
    };
  }

  const phase = (elapsed / SWEEP_PERIOD_MS) * Math.PI * 2;
  return {
    pitch: Math.sin(phase) * SWEEP_DEGREES,
    roll: Math.cos(phase * 0.5) * SWEEP_DEGREES,
  };
}

function send(frame: Readonly<Record<string, unknown>>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

function stop(): void {
  clearInterval(frameTimer);
  clearInterval(heartbeatTimer);
}

function readOptions(argv: readonly string[]): Options {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const port = Number(valueAfter("--port"));

  return {
    host: valueAfter("--host") ?? "localhost",
    port: Number.isInteger(port) && port > 0 ? port : 5184,
    mode: argv.includes("--rest") ? "rest" : "sweep",
    glitch: argv.includes("--glitch"),
    button: argv.includes("--button"),
  };
}
