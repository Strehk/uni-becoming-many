/**
 * Controller setup page (`/pair.html`) — point the M5 at this station over USB.
 *
 * The controller stores its WiFi credentials and one `ws://` target URL in flash. Changing
 * either means sending it a single newline-delimited JSON line over USB serial. That is all this
 * page does, using Web Serial directly from the browser: no CLI, no Python, no host tooling.
 *
 * Firmware protocol (see `firmware/m5-controller/README.md` in the Icaros_Host repo):
 *   → {"type":"configure","ssid":…,"password":…,"serverUrl":"ws://…/ws/device?pairing=…","deviceId":…}
 *   → {"type":"diagnose"}   → {"type":"reboot"}
 *   ← configureResult · diagnoseResult · status · register · heartbeat · orientation
 *
 * The bridge URL is pre-filled from this page's own hostname plus the bridge's device port, so
 * opening the page *from the station machine* already produces the right address. The pairing
 * token comes from the bridge over the same origin.
 *
 * Web Serial is Chrome/Edge desktop only. That is the right constraint: the controller is
 * configured at a desk with a USB cable, never from inside the headset.
 */
import "./style.css";

const BAUD_RATE = 115_200;
const DEFAULT_DEVICE_ID = "icaros-station-a-m5";
/**
 * WLAN-Zugangsdaten bleiben im Browser dieses Rechners, damit ein zweiter Controller nicht
 * wieder abgetippt werden muss. Klartext im localStorage — das ist für den Einrichtungsrechner
 * am Stand vertretbar, für einen geteilten Rechner nicht.
 */
const WIFI_STORAGE_KEY = "becoming-many.pair.wifi";
/** Keep the log bounded — the firmware mirrors orientation frames continuously. */
const MAX_LOG_LINES = 200;

type FirmwareFrame = Readonly<Record<string, unknown>>;

const root = document.querySelector<HTMLDivElement>("#pair");
if (!root) {
  throw new Error("#pair mount point not found");
}

// A hoisted function, so the markup can live at the bottom of the file without a TDZ trap.
root.innerHTML = pageHtml();

const el = <T extends HTMLElement>(key: string): T => {
  const found = root.querySelector<T>(`[data-pair="${key}"]`);
  if (!found) {
    throw new Error(`pair: missing node "${key}"`);
  }
  return found;
};

const fields = {
  ssid: el<HTMLInputElement>("ssid"),
  password: el<HTMLInputElement>("password"),
  serverUrl: el<HTMLInputElement>("serverUrl"),
  deviceId: el<HTMLInputElement>("deviceId"),
};
const buttons = {
  connect: el<HTMLButtonElement>("connect"),
  configure: el<HTMLButtonElement>("configure"),
  diagnose: el<HTMLButtonElement>("diagnose"),
  reboot: el<HTMLButtonElement>("reboot"),
};
const status = el("status");
const logView = el("log");
const level = el("level");
const levelDot = el("levelDot");
const firmware = el("firmware");

let port: SerialPort | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reading: Promise<void> | null = null;
const logLines: string[] = [];

// --- Setup ------------------------------------------------------------------

if (navigator.serial === undefined) {
  setStatus(
    "Dieser Browser kann kein Web Serial. Chrome oder Edge am Rechner öffnen — im Headset " +
      "funktioniert die Controller-Einrichtung nicht.",
    "error",
  );
  buttons.connect.disabled = true;
} else {
  setStatus("Bereit. Controller per USB anschließen und verbinden.", "idle");
}

fields.deviceId.value = DEFAULT_DEVICE_ID;
restoreWifi();
void prefillServerUrl();

// --- WLAN-Zugangsdaten merken -----------------------------------------------

for (const field of [fields.ssid, fields.password]) {
  field.addEventListener("change", storeWifi);
}
el<HTMLButtonElement>("forget").addEventListener("click", forgetWifi);

function restoreWifi(): void {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WIFI_STORAGE_KEY);
  } catch {
    // Privater Modus oder blockierter Storage — dann eben ohne Merken.
    return;
  }
  if (raw === null) {
    return;
  }

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return;
  }
  fields.ssid.value = readString(stored, "ssid") ?? "";
  fields.password.value = readString(stored, "password") ?? "";
  if (fields.ssid.value !== "") {
    log(`· WLAN „${fields.ssid.value}“ aus dem Browser-Speicher übernommen.`);
  }
}

function storeWifi(): void {
  const ssid = fields.ssid.value.trim();
  const password = fields.password.value;
  try {
    if (ssid === "" && password === "") {
      window.localStorage.removeItem(WIFI_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(WIFI_STORAGE_KEY, JSON.stringify({ ssid, password }));
  } catch {
    // Nicht schlimm genug, um die Einrichtung zu unterbrechen.
  }
}

function forgetWifi(): void {
  fields.ssid.value = "";
  fields.password.value = "";
  try {
    window.localStorage.removeItem(WIFI_STORAGE_KEY);
  } catch {
    // s. o.
  }
  setStatus("WLAN-Zugangsdaten aus diesem Browser gelöscht.", "idle");
}

/**
 * Ask our own bridge for the pairing token and the device port, then build the URL the
 * controller should dial. Falls back to a template with a visible placeholder if the bridge is
 * not reachable — the page still works, the operator just fills the token in by hand.
 */
async function prefillServerUrl(): Promise<void> {
  const host = window.location.hostname;
  try {
    const response = await fetch("/api/m5/token", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const body: unknown = await response.json();
    const token = readString(body, "token");
    const devicePort = readNumber(body, "devicePort") ?? 5184;
    fields.serverUrl.value = `ws://${host}:${devicePort}/ws/device?pairing=${token ?? "<token>"}`;
  } catch {
    fields.serverUrl.value = `ws://${host}:5184/ws/device?pairing=<token>`;
    log("! Bridge nicht erreichbar — Pairing-Token bitte von Hand eintragen.");
  }
}

// --- Serial connection ------------------------------------------------------

buttons.connect.addEventListener("click", () => {
  void (port === null ? connect() : disconnect());
});

async function connect(): Promise<void> {
  const serial = navigator.serial;
  if (serial === undefined) {
    return;
  }

  try {
    // requestPort must be called from a user gesture; the browser shows the port picker.
    port = await serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });
  } catch (error) {
    port = null;
    setStatus(`Verbindung fehlgeschlagen: ${describe(error)}`, "error");
    return;
  }

  const writable = port.writable;
  writer = writable ? writable.getWriter() : null;
  setConnected(true);
  setStatus("Verbunden. Der Controller meldet sich gleich mit Status-Frames.", "ok");
  reading = readLoop();

  // Ask for a status snapshot right away rather than waiting for the 5 s periodic one.
  await send({ type: "diagnose" });
}

async function disconnect(): Promise<void> {
  const closing = port;
  port = null;
  try {
    await writer?.close();
  } catch {
    // The writer is already gone if the cable was pulled — nothing to salvage.
  }
  writer = null;
  await reading?.catch(() => {});
  reading = null;
  await closing?.close().catch(() => {});
  setConnected(false);
  setStatus("Getrennt.", "idle");
}

/** Read newline-delimited JSON off the port until the port closes or the cable is pulled. */
async function readLoop(): Promise<void> {
  let buffer = "";
  const decoder = new TextDecoder();

  while (port?.readable) {
    const reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          handleLine(buffer.slice(0, newline).trim());
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
        // A device that never sends a newline must not grow the buffer without bound.
        if (buffer.length > 4096) {
          buffer = "";
        }
      }
    } catch (error) {
      setStatus(`Verbindung verloren: ${describe(error)}`, "error");
      return;
    } finally {
      reader.releaseLock();
    }
  }
}

async function send(message: Readonly<Record<string, unknown>>): Promise<void> {
  if (writer === null) {
    setStatus("Kein Controller verbunden.", "error");
    return;
  }
  const line = `${JSON.stringify(message)}\n`;
  await writer.write(new TextEncoder().encode(line));
  log(`→ ${redact(line.trim())}`);
}

// --- Firmware frames --------------------------------------------------------

function handleLine(line: string): void {
  if (line.length === 0) {
    return;
  }

  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    log(`← ${line}`); // the firmware also prints plain boot chatter
    return;
  }
  if (typeof frame !== "object" || frame === null) {
    return;
  }

  const typed = frame as FirmwareFrame;
  const type = readString(typed, "type");

  if (type === "orientation") {
    // Shown as a live level instead of log spam — the firmware mirrors these every 250 ms.
    renderLevel(readNumber(typed, "pitch") ?? 0, readNumber(typed, "roll") ?? 0);
    return;
  }

  log(`← ${redact(line)}`);

  const version = readString(typed, "firmwareVersion");
  if (version !== null) {
    firmware.textContent = version;
  }

  if (type === "configureResult") {
    const ok = typed["ok"] === true;
    const message = readString(typed, "message") ?? "";
    setStatus(ok ? `Gespeichert: ${message}` : `Fehler: ${message}`, ok ? "ok" : "error");
    return;
  }

  if (type === "diagnoseResult") {
    renderDiagnosis(typed);
  }
}

/**
 * Turn a diagnose frame into the one sentence the operator needs: did the controller reach our
 * bridge, and if not, how far did it get?
 */
function renderDiagnosis(frame: FirmwareFrame): void {
  const connected = frame["webSocketConnected"] === true;
  const tcpOk = frame["tcpProbeOk"] === true;
  const localIp = readString(frame, "localIp") ?? "";
  const lastError = readString(frame, "lastWebSocketError") ?? "";

  if (connected) {
    setStatus(`Controller ist mit der Bridge verbunden (IP ${localIp}).`, "ok");
    return;
  }
  if (localIp === "") {
    setStatus("Controller hängt noch nicht im WLAN — SSID und Passwort prüfen.", "error");
    return;
  }
  if (!tcpOk) {
    const hint = "Läuft der Dev-Server, und ist die IP in der Bridge-URL die dieses Rechners?";
    setStatus(`WLAN ok (IP ${localIp}), aber die Bridge ist nicht erreichbar. ${hint}`, "error");
    return;
  }
  const detail = lastError === "" ? "" : `: ${lastError}`;
  const hint = "Meist ein falscher Pairing-Token.";
  setStatus(`WLAN und Port ok (IP ${localIp}), aber kein WebSocket${detail}. ${hint}`, "error");
}

// --- Actions ----------------------------------------------------------------

buttons.configure.addEventListener("click", () => {
  const ssid = fields.ssid.value.trim();
  const serverUrl = fields.serverUrl.value.trim();
  const deviceId = fields.deviceId.value.trim();

  if (ssid === "" || serverUrl === "" || deviceId === "") {
    setStatus("SSID, Bridge-URL und Geräte-ID dürfen nicht leer sein.", "error");
    return;
  }
  if (!serverUrl.startsWith("ws://")) {
    // The firmware rejects wss:// outright; catching it here saves a confusing round trip.
    setStatus("Die Bridge-URL muss mit ws:// beginnen — die Firmware kann kein wss://.", "error");
    return;
  }

  storeWifi();
  void send({
    type: "configure",
    ssid,
    password: fields.password.value,
    serverUrl,
    deviceId,
  });
});

buttons.diagnose.addEventListener("click", () => void send({ type: "diagnose" }));
buttons.reboot.addEventListener("click", () => void send({ type: "reboot" }));

// --- Rendering --------------------------------------------------------------

function setConnected(connected: boolean): void {
  buttons.connect.textContent = connected ? "Trennen" : "Controller verbinden";
  for (const button of [buttons.configure, buttons.diagnose, buttons.reboot]) {
    button.disabled = !connected;
  }
  if (!connected) {
    levelDot.style.left = "50%";
    levelDot.style.top = "50%";
  }
}

function setStatus(text: string, kind: "idle" | "ok" | "error"): void {
  status.textContent = text;
  status.dataset["kind"] = kind;
}

/** Pitch/roll in degrees onto a ±45° pad, so a badly mounted controller is visible immediately. */
function renderLevel(pitch: number, roll: number): void {
  const x = Math.max(-1, Math.min(1, roll / 45));
  const y = Math.max(-1, Math.min(1, pitch / 45));
  // 45 % rather than 50 % keeps the dot fully inside the pad at full deflection.
  levelDot.style.left = `${50 + x * 45}%`;
  levelDot.style.top = `${50 - y * 45}%`;
  level.title = `pitch ${pitch.toFixed(1)}° · roll ${roll.toFixed(1)}°`;
}

function log(line: string): void {
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) {
    logLines.shift();
  }
  logView.textContent = logLines.join("\n");
  logView.scrollTop = logView.scrollHeight;
}

/** Never print the WiFi password or the pairing token into the on-screen log. */
function redact(line: string): string {
  return line
    .replace(/"password":"[^"]*"/g, '"password":"…"')
    .replace(/pairing=[^"&\s]*/g, "pairing=…");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const found = (value as Readonly<Record<string, unknown>>)[key];
  return typeof found === "string" ? found : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const found = (value as Readonly<Record<string, unknown>>)[key];
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

// --- Markup -----------------------------------------------------------------

function pageHtml(): string {
  return `
  <header class="pair__head">
    <h1>Controller einrichten</h1>
    <p class="pair__lede">
      Den M5 per USB anschließen, WLAN und Bridge-Adresse schreiben, Kabel wieder abziehen.
      Danach meldet sich der Controller von selbst bei dieser Station.
    </p>
    <a class="pair__back" href="/">← zur Experience</a>
  </header>

  <section class="pair__card">
    <div class="pair__row">
      <button type="button" class="pair__button pair__button--primary" data-pair="connect">
        Controller verbinden
      </button>
      <span class="pair__meta">Firmware: <b data-pair="firmware">–</b></span>
    </div>
    <p class="pair__status" data-pair="status" data-kind="idle"></p>
  </section>

  <section class="pair__card">
    <h2>Konfiguration</h2>
    <label class="pair__field">
      <span>WLAN-SSID</span>
      <input type="text" data-pair="ssid" autocomplete="off" spellcheck="false" />
    </label>
    <label class="pair__field">
      <span>WLAN-Passwort</span>
      <input type="password" data-pair="password" autocomplete="off" />
    </label>
    <p class="pair__hint">
      SSID und Passwort bleiben in diesem Browser gespeichert, damit der nächste Controller
      ohne Abtippen läuft — im Klartext, also nur auf dem Rechner am Stand.
      <button type="button" class="pair__link" data-pair="forget">Zugangsdaten vergessen</button>
    </p>
    <label class="pair__field">
      <span>Bridge-URL <i>(muss ws:// sein — die Firmware kann kein wss://)</i></span>
      <input type="text" data-pair="serverUrl" autocomplete="off" spellcheck="false" />
    </label>
    <label class="pair__field">
      <span>Geräte-ID</span>
      <input type="text" data-pair="deviceId" autocomplete="off" spellcheck="false" />
    </label>
    <div class="pair__row">
      <button type="button" class="pair__button pair__button--primary" data-pair="configure" disabled>
        Auf den Controller schreiben
      </button>
      <button type="button" class="pair__button" data-pair="diagnose" disabled>Diagnose</button>
      <button type="button" class="pair__button" data-pair="reboot" disabled>Neustart</button>
    </div>
  </section>

  <section class="pair__card">
    <h2>Lage</h2>
    <p class="pair__hint">
      Live aus den Orientierungs-Frames des Controllers. Der Punkt gehört in die Mitte, wenn der
      Controller flach liegt — tut er das nicht, sitzt er verdreht in der Halterung.
    </p>
    <div class="pair__level" data-pair="level"><i data-pair="levelDot"></i></div>
  </section>

  <section class="pair__card">
    <h2>Protokoll</h2>
    <pre class="pair__log" data-pair="log"></pre>
  </section>
`;
}
