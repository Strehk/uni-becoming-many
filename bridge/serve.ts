#!/usr/bin/env bun
/**
 * Production entry: serve the built experience and run the M5 bridge in one process.
 *
 * Two listeners, for the same reason as in dev:
 *   · `PORT` (8080) — the app plus the browser control stream on `/ws/m5`. TLS is terminated by
 *     the reverse proxy in front, so this speaks plain HTTP and `wss://…/ws/m5` arrives here as
 *     an ordinary upgrade.
 *   · `M5_DEVICE_PORT` (5184) — plain HTTP for the controller, whose firmware refuses `wss://`.
 *
 * **This has to run on the same LAN as the controller.** A remote deployment simply never
 * receives device frames: the experience still runs, `quality` stays 0, and the keyboard works —
 * but there is no controller. Station deployments run this image locally.
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { DEFAULT_DEVICE_PORT, TOKEN_PATH, createBridge } from "./index.ts";
import { resolveStateDir } from "./state.ts";
import { createStaticHandler } from "./static.ts";

const appPort = readPort(process.env["PORT"], 8080);
const devicePort = readPort(process.env["M5_DEVICE_PORT"], DEFAULT_DEVICE_PORT);
const host = process.env["HOST"] ?? "0.0.0.0";
const distDir = resolve(process.env["M5_DIST_DIR"] ?? "dist");

const bridge = createBridge();
const serveStatic = createStaticHandler(distDir);

const appServer = createServer((request, response) => {
  // The pairing page reads this to build the URL it writes to the controller over USB.
  if (new URL(request.url ?? "/", "http://localhost").pathname === TOKEN_PATH) {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ token: bridge.pairingToken, devicePort }));
    return;
  }
  serveStatic(request, response);
});
bridge.attachBrowser(appServer);

const deviceServer = createServer((_request, response) => {
  response.writeHead(426, { "content-type": "text/plain" });
  response.end("Upgrade required\n");
});
bridge.attachDevice(deviceServer);

appServer.listen(appPort, host, () => {
  console.log("");
  console.log("Becoming Many is running");
  console.log(`  app + control stream  http://${host}:${appPort}   (serving ${distDir})`);
  console.log(`  controller endpoint   ws://<lan-ip>:${devicePort}/ws/device`);
  console.log(`  bridge state          ${resolveStateDir()}`);
  console.log("");
});
deviceServer.listen(devicePort, host);

for (const server of [appServer, deviceServer]) {
  server.on("error", (error) => {
    console.error("[m5] listener failed:", error);
    process.exit(1);
  });
}

const shutdown = (): void => {
  bridge.dispose();
  appServer.close();
  deviceServer.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
