/**
 * Bridge state on disk: calibration, axis map, and the device pairing token.
 *
 * All three belong to the *station*, not to a browser session — the rig is calibrated once and
 * every later visitor should get that same zero. The directory defaults to `.m5/` next to the
 * project (git-ignored) and is overridable with `M5_STATE_DIR`, which the container points at a
 * volume so a redeploy does not lose the calibration.
 *
 * Writes are best-effort: a read-only filesystem degrades to in-memory state rather than taking
 * the flight experience down with it.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type Calibration,
  NEUTRAL_CALIBRATION,
  readCalibration,
} from "../src/m5/pipeline/index.ts";
import { type AxisMap, NEUTRAL_AXIS_MAP } from "../src/m5/protocol.ts";

const DEFAULT_STATE_DIR = ".m5";
const PAIRING_TOKEN_BYTES = 18;

export interface BridgeStore {
  readonly dir: string;
  readCalibration(): Calibration;
  writeCalibration(calibration: Calibration): void;
  readAxisMap(): AxisMap;
  writeAxisMap(axisMap: AxisMap): void;
  /** The shared secret the M5 must present on `/ws/device`. Generated and persisted on first use. */
  readPairingToken(): string;
}

export function createBridgeStore(dir: string = resolveStateDir()): BridgeStore {
  const calibrationFile = resolve(dir, "calibration.json");
  const axisMapFile = resolve(dir, "axis-map.json");
  const tokenFile = resolve(dir, "pairing-token");
  let token: string | null = null;

  return {
    dir,

    readCalibration(): Calibration {
      return readCalibration(readJsonFile(calibrationFile)) ?? NEUTRAL_CALIBRATION;
    },

    writeCalibration(calibration: Calibration): void {
      writeJsonFile(calibrationFile, calibration);
    },

    readAxisMap(): AxisMap {
      const stored = readJsonFile(axisMapFile);
      if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
        return NEUTRAL_AXIS_MAP;
      }
      const candidate = stored as Readonly<Record<string, unknown>>;
      return {
        swapPitchRoll: candidate["swapPitchRoll"] === true,
        invertPitch: candidate["invertPitch"] === true,
        invertRoll: candidate["invertRoll"] === true,
      };
    },

    writeAxisMap(axisMap: AxisMap): void {
      writeJsonFile(axisMapFile, axisMap);
    },

    readPairingToken(): string {
      if (token !== null) {
        return token;
      }

      // An explicit env token wins: it lets a deployment pin the value the controller was
      // configured with instead of regenerating one on every fresh volume.
      const configured = process.env["M5_PAIRING_TOKEN"]?.trim();
      if (configured !== undefined && configured !== "") {
        token = configured;
        return token;
      }

      const stored = readTextFile(tokenFile);
      if (stored !== null && stored.length > 0) {
        token = stored;
        return token;
      }

      token = randomBytes(PAIRING_TOKEN_BYTES).toString("base64url");
      writeTextFile(tokenFile, token, 0o600);
      return token;
    },
  };
}

/** `M5_STATE_DIR` if set, else `.m5/` under the current working directory. */
export function resolveStateDir(): string {
  const configured = process.env["M5_STATE_DIR"]?.trim();
  return resolve(configured !== undefined && configured !== "" ? configured : DEFAULT_STATE_DIR);
}

function readJsonFile(path: string): unknown {
  const text = readTextFile(path);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readTextFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, 0o644);
}

function writeTextFile(path: string, contents: string, mode: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { encoding: "utf8", mode });
  } catch (error) {
    // Losing persistence is survivable; losing the flight is not.
    console.warn(`[m5] could not persist ${path}:`, error);
  }
}
