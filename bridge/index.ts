/**
 * The M5 bridge — the small server half of this repo.
 *
 * It exists for one reason: the controller firmware is a WebSocket *client* that speaks plain
 * `ws://` only (`wss://` is rejected outright, see the firmware's URL parser). A browser can
 * neither listen for it nor, from an HTTPS page, connect to it. So the bridge listens for the
 * device on a plain port, runs the control pipeline, and re-publishes finished controls to
 * browsers over the app's *own* origin — which is what removes the second certificate the old
 * ICAROS-host setup needed a headset to trust.
 *
 *   M5 ──ws://:5184/ws/device──► bridge ──pipeline──► wss://<app origin>/ws/m5 ──► browser
 *
 * Two sockets, two very different trust levels: the device socket is authenticated with a
 * pairing token and may write control data; the browser socket is public on the LAN, receives
 * control data, and may only send tuning commands (calibrate / axis flip).
 */
import { timingSafeEqual } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { type ControlPipeline, createControlPipeline } from "../src/m5/pipeline/index.ts";
import { type BridgeState, parseBridgeCommand } from "../src/m5/protocol.ts";
import { type BridgeStore, createBridgeStore } from "./state.ts";

export const DEVICE_PATH = "/ws/device";
export const BROWSER_PATH = "/ws/m5";
export const TOKEN_PATH = "/api/m5/token";
export const DEFAULT_DEVICE_PORT = 5184;

/** How often the pipeline is asked to check whether the device went quiet. */
const TICK_INTERVAL_MS = 250;

export interface Bridge {
  /** Accept browser control-stream connections on `server`. */
  attachBrowser(server: HttpServer): void;
  /** Accept M5 device connections on `server`. Keep this on a plain-HTTP listener. */
  attachDevice(server: HttpServer): void;
  /** The token the M5 must present. Shown by the pairing page so it can build the device URL. */
  readonly pairingToken: string;
  readonly state: BridgeState;
  dispose(): void;
}

export type BridgeOptions = Readonly<{ store?: BridgeStore }>;

export function createBridge(options: BridgeOptions = {}): Bridge {
  const store = options.store ?? createBridgeStore();
  const browserSockets = new Set<WebSocket>();
  const deviceSockets = new Set<WebSocket>();

  const broadcast = (message: unknown): void => {
    if (browserSockets.size === 0) {
      return;
    }
    const payload = JSON.stringify(message);
    for (const socket of browserSockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  };

  const pipeline: ControlPipeline = createControlPipeline({
    calibration: store.readCalibration(),
    axisMap: store.readAxisMap(),
    onCalibrationChange: (calibration) => store.writeCalibration(calibration),
    onAxisMapChange: (axisMap) => store.writeAxisMap(axisMap),
    onControl: (control) => broadcast({ type: "control", control }),
    onState: (state) => broadcast({ type: "state", state }),
  });

  const tick = setInterval(() => pipeline.tick(), TICK_INTERVAL_MS);
  // Never let the stale-check timer keep a process alive on its own.
  tick.unref?.();

  const deviceServer = new WebSocketServer({ noServer: true });
  const browserServer = new WebSocketServer({ noServer: true });

  deviceServer.on("connection", (socket) => {
    deviceSockets.add(socket);
    pipeline.setDeviceConnected(true);
    console.info("[m5] controller connected");

    socket.on("message", (data) => pipeline.ingest(data.toString()));
    socket.on("close", () => {
      deviceSockets.delete(socket);
      if (deviceSockets.size === 0) {
        pipeline.setDeviceConnected(false);
        console.info("[m5] controller disconnected");
      }
    });
    socket.on("error", (error) => console.warn("[m5] device socket error:", error));
  });

  browserServer.on("connection", (socket) => {
    browserSockets.add(socket);
    // Hand the newcomer the current picture instead of making it wait for the next frame.
    socket.send(JSON.stringify({ type: "control", control: pipeline.control }));
    socket.send(JSON.stringify({ type: "state", state: pipeline.state }));

    socket.on("message", (data) => handleBrowserCommand(data.toString()));
    socket.on("close", () => browserSockets.delete(socket));
    socket.on("error", () => browserSockets.delete(socket));
  });

  const handleBrowserCommand = (rawValue: string): void => {
    const command = parseBridgeCommand(rawValue);
    if (command === null) {
      return;
    }
    if (command.type === "calibrate") {
      const result = pipeline.calibrate();
      console.info(
        result.ok
          ? "[m5] calibrated current pose as neutral"
          : `[m5] calibration: ${result.message}`,
      );
      return;
    }
    if (command.type === "calibrate.reset") {
      pipeline.resetCalibration();
      return;
    }
    pipeline.setAxisField(command.field, command.enabled);
  };

  const upgradeTo = (
    server: WebSocketServer,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    server.handleUpgrade(request, socket, head, (ws) => server.emit("connection", ws, request));
  };

  return {
    attachBrowser(server: HttpServer): void {
      server.on("upgrade", (request, socket, head) => {
        if (readPathname(request) !== BROWSER_PATH) {
          return; // another handler (Vite's HMR socket, for one) owns this path
        }
        upgradeTo(browserServer, request, socket, head);
      });
    },

    attachDevice(server: HttpServer): void {
      server.on("upgrade", (request, socket, head) => {
        if (readPathname(request) !== DEVICE_PATH) {
          return;
        }
        if (!isPaired(request, store.readPairingToken())) {
          console.warn("[m5] rejected a device connection with a wrong or missing pairing token");
          socket.destroy();
          return;
        }
        upgradeTo(deviceServer, request, socket, head);
      });
    },

    get pairingToken(): string {
      return store.readPairingToken();
    },

    get state(): BridgeState {
      return pipeline.state;
    },

    dispose(): void {
      clearInterval(tick);
      for (const socket of browserSockets) {
        socket.close();
      }
      browserSockets.clear();
      // Closing the WebSocketServer leaves live sockets alone — and a controller whose socket
      // survives a dev-server restart keeps feeding the *disposed* pipeline: the firmware sees a
      // healthy connection, never reconnects, and the new bridge sits at `deviceConnected: false`
      // forever. Cut the device sockets so the firmware's reconnect loop finds the live bridge.
      for (const socket of deviceSockets) {
        socket.terminate();
      }
      deviceSockets.clear();
      pipeline.setDeviceConnected(false);
      deviceServer.close();
      browserServer.close();
    },
  };
}

function readPathname(request: IncomingMessage): string {
  // The Host header is untrusted, but only the path is read from the result.
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function isPaired(request: IncomingMessage, expected: string): boolean {
  const presented = new URL(request.url ?? "/", "http://localhost").searchParams.get("pairing");
  if (presented === null) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  return a.length === b.length && timingSafeEqual(a, b);
}
