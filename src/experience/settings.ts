// ── Becoming Many — Audience settings ────────────────────────────
//
// The two things a visitor may change before the piece starts: how good it should
// look (a quality preset id from src/perf/presets.ts) and how they steer. Kept
// separate from `experience/config.ts` — that one is the *dramaturgy* (duration,
// sense cues, an authoring concern); this one is the *device* (quality, control),
// and it is what the Einstellungen screen writes.
//
// Persisted in localStorage per device, so an exhibition machine keeps the tuning
// it was set up with and a phone keeps its gyro calibration across reloads.

import { CUSTOM_PRESET_ID } from "../perf/router.ts";

/** How the flight is steered. */
export type ControlScheme =
  /** WASD / arrow keys — the desktop default. */
  | "keyboard"
  /** The phone's own tilt (DeviceOrientation) — the mobile mode. */
  | "gyro"
  /** The ICAROS flight machine over the host WebSocket — the installation. */
  | "icaros";

export const CONTROL_LABELS: Record<ControlScheme, string> = {
  keyboard: "Tastatur",
  gyro: "Handy neigen",
  icaros: "ICAROS-Gerät",
};

export const CONTROL_NOTES: Record<ControlScheme, string> = {
  keyboard: "W/S steigen und sinken, A/D kurven, Shift beschleunigt",
  gyro: "Das Handy neigen wie ein Lenkrad — vor/zurück steigt und sinkt",
  icaros: "Steuerung kommt vom angeschlossenen ICAROS-Host",
};

export interface AppSettings {
  version: 1;
  /** Preset id from src/perf/presets.ts, or "eigene" when the sliders were used. */
  quality: string;
  control: ControlScheme;
  /**
   * Gyro deflection, in degrees of tilt, that counts as full steering input.
   * Smaller = more sensitive. Only read in the "gyro" scheme.
   */
  gyroRangeDegrees: number;
  /** Invert the front/back tilt, for anyone who reads it as "pull up to climb". */
  gyroInvertPitch: boolean;
}

const STORAGE_KEY = "becoming-many:settings:v1";

/**
 * Quality defaults to the custom marker, meaning "whatever src/perf/state.json
 * committed" — a device nobody has configured must run exactly the authored tuning,
 * not a preset that merely resembles it. Only an explicit pick in the menu overrides it.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  quality: CUSTOM_PRESET_ID,
  control: "keyboard",
  gyroRangeDegrees: 30,
  gyroInvertPitch: false,
};

export function loadAppSettings(): AppSettings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  try {
    return normalize(JSON.parse(stored));
  } catch (error) {
    console.warn("[experience] saved settings are invalid; using defaults", error);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(settings), null, 2));
}

/** True for the touch devices the mobile mode is meant for — a hint, never a gate. */
export function looksLikeMobile(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

/** True when this device can actually report tilt (no iOS permission implied). */
export function supportsDeviceOrientation(): boolean {
  return typeof window.DeviceOrientationEvent !== "undefined";
}

function normalize(input: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  if (!isRecord(input)) {
    return { ...d };
  }
  const raw = input;
  return {
    version: 1,
    quality: typeof raw["quality"] === "string" ? raw["quality"] : d.quality,
    control: isControlScheme(raw["control"]) ? raw["control"] : d.control,
    gyroRangeDegrees: clamp(raw["gyroRangeDegrees"], 10, 60, d.gyroRangeDegrees),
    gyroInvertPitch:
      typeof raw["gyroInvertPitch"] === "boolean" ? raw["gyroInvertPitch"] : d.gyroInvertPitch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isControlScheme(value: unknown): value is ControlScheme {
  return value === "keyboard" || value === "gyro" || value === "icaros";
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
