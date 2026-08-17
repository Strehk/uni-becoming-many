/**
 * Dev wiring for the M5 bridge: one Vite plugin, no extra process to start.
 *
 * The browser control stream is attached to Vite's own HTTPS server, so it arrives at
 * `wss://<whatever the dev server prints>/ws/m5` — same origin, same mkcert certificate the page
 * already uses. That is the whole point of bringing the controller in-repo: a headset accepts one
 * certificate, not two.
 *
 * The M5 itself cannot use that server, because its firmware refuses `wss://`. It gets a second,
 * plain-HTTP listener on `M5_DEVICE_PORT` (5184 by default) — the same split the ICAROS host used.
 */
import { type Server as HttpServer, createServer } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { type Bridge, DEFAULT_DEVICE_PORT, TOKEN_PATH, createBridge } from "./index.ts";

/**
 * Editing anything under `bridge/` restarts the dev server, and Vite re-imports the config as a
 * fresh timestamped module — so module scope does not survive a restart and the old device
 * listener would keep :5184 bound (`EADDRINUSE`) while the new one tries to claim it. The
 * process-wide slot lets a restart find the previous listener and take it over instead.
 */
const DEV_SLOT = Symbol.for("becoming-many.m5.devBridge");

type DevSlot = { bridge: Bridge; deviceServer: HttpServer };

function readSlot(): DevSlot | undefined {
  return (globalThis as typeof globalThis & Record<symbol, DevSlot | undefined>)[DEV_SLOT];
}

function writeSlot(slot: DevSlot | undefined): void {
  (globalThis as typeof globalThis & Record<symbol, DevSlot | undefined>)[DEV_SLOT] = slot;
}

export function m5Bridge(): Plugin {
  return {
    name: "m5-bridge",
    apply: "serve",

    configureServer(server: ViteDevServer) {
      const httpServer = server.httpServer;
      if (httpServer === null) {
        // Middleware mode — nothing to attach a WebSocket upgrade to.
        return;
      }

      const devicePort = readDevicePort();
      const bridge = createBridge();
      bridge.attachBrowser(httpServer as HttpServer);

      // Hand over from a previous run, if this is a restart.
      const previous = readSlot();
      previous?.bridge.dispose();
      const deviceServer = previous?.deviceServer ?? createDeviceServer(devicePort);
      // The old bridge's upgrade handler is still on the reused listener and now points at a
      // disposed pipeline; drop it before the new bridge registers its own.
      deviceServer.removeAllListeners("upgrade");
      bridge.attachDevice(deviceServer);
      writeSlot({ bridge, deviceServer });

      // The pairing page needs the token to build the URL it writes to the controller. Same
      // origin only; it is a LAN-scoped shared secret, not a user credential.
      server.middlewares.use(TOKEN_PATH, (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify({ token: bridge.pairingToken, devicePort }));
      });

      // Only a real process exit tears the listener down — a restart reuses it above.
      const shutdown = (): void => {
        readSlot()?.bridge.dispose();
        readSlot()?.deviceServer.close();
        writeSlot(undefined);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    },
  };
}

function createDeviceServer(port: number): HttpServer {
  const deviceServer = createServer((_request, response) => {
    // The device listener exists purely for the WebSocket upgrade.
    response.writeHead(426, { "content-type": "text/plain" });
    response.end("Upgrade required\n");
  });

  deviceServer.on("error", (error) =>
    console.error(`[m5] device listener on :${port} failed:`, error),
  );
  deviceServer.listen(port, () =>
    console.info(`[m5] controller endpoint  ws://<lan-ip>:${port}/ws/device`),
  );
  return deviceServer;
}

function readDevicePort(): number {
  const configured = Number(process.env["M5_DEVICE_PORT"]);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DEVICE_PORT;
}
