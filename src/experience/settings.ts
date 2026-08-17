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

/**
 * How the piece is being run. Not just a control scheme — each mode also decides
 * what the viewport does (fullscreen, landscape) and which cue starts the flight.
 */
export type ExperienceMode =
  /** At a computer: keyboard steering, Enter to begin. */
  | "desktop"
  /** On a phone: tilt steering, fullscreen + landscape, a tap to begin. */
  | "mobile"
  /** At the ICAROS machine: steering arrives from the host over the WebSocket. */
  | "icaros";

export const MODE_ORDER: ExperienceMode[] = ["desktop", "mobile", "icaros"];

export const MODE_LABELS: Record<ExperienceMode, string> = {
  desktop: "Desktop",
  mobile: "Mobil",
  icaros: "ICAROS",
};

export const MODE_NOTES: Record<ExperienceMode, string> = {
  desktop: "Am Rechner — W/S steigen und sinken, A/D kurven, Shift beschleunigt",
  mobile: "Auf dem Handy — das Gerät neigen wie ein Lenkrad",
  icaros: "Am Fluggerät — die Steuerung kommt vom angeschlossenen ICAROS-Host",
};

export interface AppSettings {
  version: 1;
  /** Preset id from src/perf/presets.ts, or "eigene" when the sliders were used. */
  quality: string;
  /** The mode last started — the pre-selection the menu offers next time. */
  mode: ExperienceMode;
  /**
   * Gyro deflection, in degrees of tilt, that counts as full steering input.
   * Smaller = more sensitive. Only read in the mobile mode.
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
  mode: "desktop",
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
    mode: readMode(raw) ?? d.mode,
    gyroRangeDegrees: clamp(raw["gyroRangeDegrees"], 10, 60, d.gyroRangeDegrees),
    gyroInvertPitch:
      typeof raw["gyroInvertPitch"] === "boolean" ? raw["gyroInvertPitch"] : d.gyroInvertPitch,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The mode, tolerating the field's earlier life as `control` with the names
 * keyboard/gyro — a device that was already set up must not be reset by a rename.
 */
function readMode(raw: Record<string, unknown>): ExperienceMode | null {
  const value = raw["mode"] ?? raw["control"];
  if (value === "desktop" || value === "mobile" || value === "icaros") {
    return value;
  }
  if (value === "keyboard") {
    return "desktop";
  }
  if (value === "gyro") {
    return "mobile";
  }
  return null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
