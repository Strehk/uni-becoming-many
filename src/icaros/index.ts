/**
 * ICAROS host communication — the client's connection to an ICAROS Host.
 *
 * Implements the "neural-flight.v1" contract (see the ICAROS_Client_Erstellen guide):
 *   1. Open the runtime WebSocket (`/ws/runtime`) and register with `client.hello`.
 *   2. After `client.registered`, send `client.heartbeat` every 4s so the host keeps
 *      us as a valid launch target; surface `client.rejected` and close on failure.
 *   3. Open the control WebSocket (`/ws/control/main`) and receive normalized
 *      `control.orientation` data (read-only — the client never sends here).
 *
 * Deliberately out of scope (per the contract): direct M5 access, `/ws/device`,
 * `/api/m5-pairing`, reconnection, and any rendering/VR logic. External socket data is
 * treated as `unknown` until validated; only checked values reach the caller.
 */

// --- Protocol constants: these must match the host. -------------------------
const PROTOCOL = "neural-flight.v1";
const STATION_ID = "station-a";
const RUNTIME_PATH = "/ws/runtime";
const CONTROL_PATH = "/ws/control/main";
const HEARTBEAT_MS = 4_000;

/** Normalized controller orientation streamed by the host. */
export type ControlOrientation = Readonly<{
  /** Forward/backward inclination, range -1..1. */
  pitch: number;
  /** Left/right inclination, range -1..1. */
  roll: number;
  /** Signal strength, range 0..1 (0 is neutral operation, not failure). */
  quality: number;
  controllerType: "m5";
}>;

/** Everything needed to register with a host and receive controller data. */
export type HostConnectionOptions = Readonly<{
  /** Host origin, e.g. `https://<host>:5183`. */
  hostOrigin: string;
  /** Unique id for this client instance. */
  clientId: string;
  /** Stable project identifier shown to the host, e.g. `becoming-many`. */
  experienceId: string;
  /** Display name shown in the host console. */
  title: string;
  /** Genuine HTTPS URL the host may redirect to on `/launch` (reachable by the headset). */
  clientUrl: string;
  /** Called for every validated orientation frame — flow this into client state. */
  onOrientation: (orientation: ControlOrientation) => void;
  onRegistered?: () => void;
  onRejected?: (reason: string) => void;
}>;

type Runtime = { options: HostConnectionOptions; socket: WebSocket; heartbeatId?: number };
type RuntimeResult =
  | { type: "registered"; clientId: string }
  | { type: "rejected"; reason: string };

// --- Messages: the JSON objects sent to the host. ---------------------------
function createHello(options: HostConnectionOptions): object {
  return {
    protocol: PROTOCOL,
    type: "client.hello",
    stationId: STATION_ID,
    source: { role: "experience", id: options.clientId },
    timestamp: Date.now(),
    payload: {
      role: "experience",
      clientId: options.clientId,
      experienceId: options.experienceId,
      title: options.title,
      url: options.clientUrl,
      userAgent: navigator.userAgent,
    },
  };
}

function createHeartbeat(clientId: string): object {
  return {
    protocol: PROTOCOL,
    type: "client.heartbeat",
    stationId: STATION_ID,
    source: { role: "experience", id: clientId },
    timestamp: Date.now(),
    payload: { clientId },
  };
}

// --- WebSocket & JSON: browser APIs are enough here. ------------------------
function createWebSocketUrl(hostOrigin: string, path: string): string {
  const url = new URL(hostOrigin.includes("://") ? hostOrigin : `https://${hostOrigin}`);
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
  url.pathname = path;
  url.port ||= "5183";
  return url.toString();
}

function sendJson(socket: WebSocket, message: object): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

function parseJson(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue) as unknown;
  } catch {
    return null;
  }
}

// --- Validation: external data stays `unknown` until it is checked. ---------
// Host frames are narrowed into these shapes (all fields optional `unknown`) so members
// are read via declared-property access — satisfying both `noPropertyAccessFromIndexSignature`
// (no index signature) and Biome's `useLiteralKeys` (no bracketed string literals).
type RawMessage = { protocol?: unknown; stationId?: unknown; type?: unknown; payload?: unknown };
type RawPayload = {
  clientId?: unknown;
  reason?: unknown;
  pitch?: unknown;
  roll?: unknown;
  quality?: unknown;
  controllerType?: unknown;
};

function isRawMessage(value: unknown): value is RawMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRawPayload(value: unknown): value is RawPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntimeResult(rawValue: string): RuntimeResult | null {
  const message = parseJson(rawValue);
  if (!isRawMessage(message) || message.protocol !== PROTOCOL || message.stationId !== STATION_ID) {
    return null;
  }

  const payload: RawPayload = isRawPayload(message.payload) ? message.payload : {};
  if (message.type === "client.registered" && typeof payload.clientId === "string") {
    return { type: "registered", clientId: payload.clientId };
  }

  if (message.type !== "client.rejected") {
    return null;
  }

  const reason = payload.reason;
  return {
    type: "rejected",
    reason: typeof reason === "string" ? reason : "Handshake wurde abgelehnt",
  };
}

function isControlPayload(value: unknown): value is ControlOrientation {
  return (
    isRawPayload(value) &&
    typeof value.pitch === "number" &&
    typeof value.roll === "number" &&
    typeof value.quality === "number" &&
    value.controllerType === "m5"
  );
}

function readOrientation(rawValue: string): ControlOrientation | null {
  const message = parseJson(rawValue);
  if (!isRawMessage(message) || message.protocol !== PROTOCOL || message.stationId !== STATION_ID) {
    return null;
  }
  if (message.type !== "control.orientation" || !isControlPayload(message.payload)) {
    return null;
  }
  return message.payload;
}

// --- Runtime handshake: each function does one small step. ------------------
function startHeartbeat(runtime: Runtime): void {
  window.clearInterval(runtime.heartbeatId);
  runtime.heartbeatId = window.setInterval(
    () => sendJson(runtime.socket, createHeartbeat(runtime.options.clientId)),
    HEARTBEAT_MS,
  );
}

function handleHostMessage(runtime: Runtime, rawValue: string): void {
  const result = readRuntimeResult(rawValue);
  if (result === null) {
    return;
  }

  if (result.type === "registered" && result.clientId === runtime.options.clientId) {
    runtime.options.onRegistered?.();
    startHeartbeat(runtime);
    return;
  }

  if (result.type !== "rejected") {
    return;
  }

  runtime.options.onRejected?.(result.reason);
  runtime.socket.close();
}

function attachRuntimeEvents(runtime: Runtime): void {
  const { socket } = runtime;
  socket.addEventListener("open", () => {
    console.info("[icaros] runtime socket open — sending client.hello");
    sendJson(socket, createHello(runtime.options));
  });
  socket.addEventListener("message", (event: MessageEvent<string>) =>
    handleHostMessage(runtime, event.data),
  );
  socket.addEventListener("error", () =>
    console.error(
      "[icaros] runtime socket error — host unreachable, or its TLS certificate is not " +
        "trusted by this browser. Open the host origin directly in this browser, accept the " +
        "certificate, then reload the client.",
    ),
  );
  socket.addEventListener("close", (event: CloseEvent) => {
    window.clearInterval(runtime.heartbeatId);
    const reason = event.reason ? `: ${event.reason}` : "";
    console.warn(`[icaros] runtime socket closed (code ${event.code}${reason})`);
  });
}

function startHandshake(options: HostConnectionOptions): () => void {
  const url = createWebSocketUrl(options.hostOrigin, RUNTIME_PATH);
  console.info(`[icaros] connecting runtime → ${url}`);
  const socket = new WebSocket(url);
  const runtime: Runtime = { options, socket };
  attachRuntimeEvents(runtime);
  return () => {
    window.clearInterval(runtime.heartbeatId);
    socket.close();
  };
}

// --- Control stream: receive validated orientation, hand it to the client. --
function handleControlMessage(
  rawValue: string,
  onOrientation: (orientation: ControlOrientation) => void,
): void {
  const orientation = readOrientation(rawValue);
  if (orientation === null) {
    return;
  }
  // From here the host data is validated and safe for the client to use.
  onOrientation(orientation);
}

function startControllerStream(
  hostOrigin: string,
  onOrientation: (orientation: ControlOrientation) => void,
): () => void {
  const url = createWebSocketUrl(hostOrigin, CONTROL_PATH);
  console.info(`[icaros] connecting control → ${url}`);
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => console.info("[icaros] control socket open"));
  socket.addEventListener("message", (event: MessageEvent<string>) =>
    handleControlMessage(event.data, onOrientation),
  );
  socket.addEventListener("error", () =>
    console.error("[icaros] control socket error — see the runtime socket note above."),
  );
  socket.addEventListener("close", (event: CloseEvent) =>
    console.warn(`[icaros] control socket closed (code ${event.code})`),
  );
  return () => socket.close();
}

// --- Public API: compose the prepared steps; return a single teardown. ------
/**
 * Connect to an ICAROS host: register + heartbeat on the runtime socket and receive
 * controller orientation on the control socket. Returns a cleanup function that stops
 * the heartbeat and closes both sockets — call it when leaving the page.
 */
export function connectHost(options: HostConnectionOptions): () => void {
  const stopHandshake = startHandshake(options);
  const stopStream = startControllerStream(options.hostOrigin, options.onOrientation);
  return () => {
    stopHandshake();
    stopStream();
  };
}
