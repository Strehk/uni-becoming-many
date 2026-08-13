// ── Becoming Many — Comfort settings ───────────────────────────
//
// Small, persisted view-comfort tuning that is separate from the authored
// ExperienceConfig (which schedules the senses). Currently one knob: the VR
// **world tilt**, a constant downward pitch of the rendered world that eases
// neck strain in prone (ICAROS) flight — see `Player.setWorldTilt`.
//
// Stored in localStorage so a chosen tilt survives reloads on a headset without
// a keyboard or a commit. The dev-console "Komfort" slider reads and writes it.

export interface ComfortConfig {
  version: 1;
  /**
   * VR world tilt, in **degrees** downward (0 = off). Applied only while a headset is presenting;
   * the flat web page is never tilted. Clamped to [0, MAX_WORLD_TILT_DEG] on load.
   */
  worldTiltDeg: number;
}

const STORAGE_KEY = "becoming-many:comfort:v1";

/** Upper bound on the tilt slider — beyond this a pitched horizon gets disorienting fast. */
export const MAX_WORLD_TILT_DEG = 30;

/** A gentle default: "a little bit downward", enough to relax the neck without a jarring horizon. */
export const DEFAULT_COMFORT_CONFIG: ComfortConfig = {
  version: 1,
  worldTiltDeg: 12,
};

function clampTilt(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : DEFAULT_COMFORT_CONFIG.worldTiltDeg;
  return Math.max(0, Math.min(MAX_WORLD_TILT_DEG, n));
}

export function loadComfort(): ComfortConfig {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_COMFORT_CONFIG };
  }
  try {
    const raw = JSON.parse(stored) as Record<string, unknown>;
    return { version: 1, worldTiltDeg: clampTilt(raw?.["worldTiltDeg"]) };
  } catch (error) {
    console.warn("[comfort] saved config is invalid; using defaults", error);
    return { ...DEFAULT_COMFORT_CONFIG };
  }
}

export function saveComfort(config: ComfortConfig): void {
  const normalized: ComfortConfig = { version: 1, worldTiltDeg: clampTilt(config.worldTiltDeg) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
}

/** Degrees → radians, for handing the stored tilt to `Player.setWorldTilt`. */
export function worldTiltRadians(config: ComfortConfig): number {
  return (config.worldTiltDeg * Math.PI) / 180;
}
