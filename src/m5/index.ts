/**
 * The controller, as the experience sees it.
 *
 * One factory, one live value to read each frame, one teardown — the same shape as
 * `createKeyboardControls`, so the frame loop treats both inputs alike. Everything upstream
 * (device socket, degrees, calibration, safety clamps) belongs to the bridge; nothing of it
 * shows up here.
 *
 * The stream arrives over this page's **own origin** (`wss://<origin>/ws/m5`), which is why
 * there is no host to configure: no `?host=`, no baked-in IP, and only the one certificate the
 * page itself already uses. Without a bridge the socket simply never opens and `input.quality`
 * stays 0 — the documented "nothing is steering" state, which is exactly what keyboard-only
 * operation looks like.
 */
import {
  type AxisMapField,
  type BridgeState,
  type ControlFrame,
  parseBridgeMessage,
} from "./protocol.ts";

/** Reconnect backoff bounds. A station left running should recover on its own. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5_000;

export type ControllerButton = {
  pressed: boolean;
  /** True only on the frame the button went down. Cleared once read by `consumeButtonDown`. */
  down: boolean;
  up: boolean;
};

/** Live controller input. Mutated in place — read it every frame, never cache the fields. */
export type ControllerInput = {
  /** -1..1. Positive climbs. */
  pitch: number;
  /** -1..1. */
  roll: number;
  /** 0..1. 0 means nothing is steering — a normal state, not an error. */
  quality: number;
  button: ControllerButton;
};

export type ControllerStatus = "offline" | "waiting" | "live";

export interface Controller {
  readonly input: ControllerInput;
  /**
   * `offline` — no bridge reachable; `waiting` — bridge connected, no controller paired;
   * `live` — controller frames arriving.
   */
  readonly status: ControllerStatus;
  /** Latest operator-facing bridge state, or null before the first state message. */
  readonly bridgeState: BridgeState | null;
  /**
   * Read-and-clear the button-down edge. The bridge sends the edge on one frame at 20 Hz while
   * the render loop runs at 60–90 Hz, so a plain read would miss it or see it three times.
   */
  consumeButtonDown(): boolean;
  /** Ask the bridge to treat the current pose as neutral. */
  calibrate(): void;
  resetCalibration(): void;
  setAxisField(field: AxisMapField, enabled: boolean): void;
  /** Called whenever status or bridge state changes — for the dev console. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export type ControllerOptions = Readonly<{
  /** Override the bridge URL. Defaults to `/ws/m5` on this page's origin. */
  url?: string;
}>;

export function createController(options: ControllerOptions = {}): Controller {
  const url = options.url ?? defaultBridgeUrl();
  const input: ControllerInput = {
    pitch: 0,
    roll: 0,
    quality: 0,
    button: { pressed: false, down: false, up: false },
  };

  const listeners = new Set<() => void>();
  let status: ControllerStatus = "offline";
  let bridgeState: BridgeState | null = null;
  let socket: WebSocket | null = null;
  let reconnectDelayMs = RECONNECT_MIN_MS;
  let reconnectTimer = 0;
  let pendingButtonDown = false;
  let disposed = false;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setStatus = (next: ControllerStatus): void => {
    if (status === next) {
      return;
    }
    status = next;
    notify();
  };

  const applyControl = (control: ControlFrame): void => {
    input.pitch = control.pitch;
    input.roll = control.roll;
    input.quality = control.quality;
    input.button.pressed = control.buttonPressed;
    input.button.down = control.buttonDown;
    input.button.up = control.buttonUp;
    // Latch the edge so a frame loop running faster than 20 Hz cannot miss it.
    pendingButtonDown ||= control.buttonDown;
    setStatus(control.quality > 0 ? "live" : "waiting");
  };

  const connect = (): void => {
    if (disposed) {
      return;
    }

    const next = new WebSocket(url);
    socket = next;

    next.addEventListener("open", () => {
      console.info(`[m5] bridge connected — ${url}`);
      reconnectDelayMs = RECONNECT_MIN_MS;
      setStatus("waiting");
    });

    next.addEventListener("message", (event: MessageEvent<string>) => {
      const message = parseBridgeMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.type === "control") {
        applyControl(message.control);
        return;
      }
      bridgeState = message.state;
      notify();
    });

    next.addEventListener("close", () => {
      if (disposed) {
        return;
      }
      // Nothing is steering any more — never leave the last pose banked.
      applyControl({
        pitch: 0,
        roll: 0,
        quality: 0,
        buttonPressed: false,
        buttonDown: false,
        buttonUp: false,
        controllerType: "m5",
      });
      setStatus("offline");
      reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
    });

    // A failed connection also fires `close`, which owns the retry — nothing to do here beyond
    // keeping the console quiet: with no bridge running this would log twice a second.
    next.addEventListener("error", () => {});
  };

  const send = (command: unknown): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  };

  connect();

  return {
    input,
    get status(): ControllerStatus {
      return status;
    },
    get bridgeState(): BridgeState | null {
      return bridgeState;
    },
    consumeButtonDown(): boolean {
      const pressed = pendingButtonDown;
      pendingButtonDown = false;
      return pressed;
    },
    calibrate(): void {
      send({ type: "calibrate" });
    },
    resetCalibration(): void {
      send({ type: "calibrate.reset" });
    },
    setAxisField(field: AxisMapField, enabled: boolean): void {
      send({ type: "axis", field, enabled });
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      listeners.clear();
      socket?.close();
      socket = null;
    },
  };
}

/** `/ws/m5` on this page's own origin — https→wss, http→ws. */
function defaultBridgeUrl(): string {
  const url = new URL("/ws/m5", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export type { AxisMap, AxisMapField, BridgeState } from "./protocol.ts";
