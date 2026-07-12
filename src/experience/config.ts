import { SENSE_KEY_ORDER, SENSE_LABELS, SENSE_ORDER, isSenseId, type SenseId } from "../senses/ids.ts";
import { signals } from "../signals/index.ts";

export interface SenseCueConfig {
  id: SenseId;
  enabled: boolean;
  start: number;
  intensity: number;
}

export interface ExperienceConfig {
  version: 1;
  duration: number;
  cues: SenseCueConfig[];
}

const STORAGE_KEY = "becoming-many:experience-config:v1";
const DEFAULT_DURATION = 300;
const SCHEDULE_ORDER = SENSE_KEY_ORDER.filter((id): id is SenseId => id !== null);

const DEFAULT_STARTS = new Map<SenseId, number>(
  SCHEDULE_ORDER.map((id, index) => [id, ((index + 1) * DEFAULT_DURATION) / (SCHEDULE_ORDER.length + 1)]),
);

export const DEFAULT_EXPERIENCE_CONFIG: ExperienceConfig = {
  version: 1,
  duration: DEFAULT_DURATION,
  cues: SENSE_ORDER.map((id) => ({
    id,
    enabled: DEFAULT_STARTS.has(id),
    start: DEFAULT_STARTS.get(id) ?? DEFAULT_DURATION,
    intensity: 1,
  })),
};

export function orderedCues(config: ExperienceConfig): SenseCueConfig[] {
  const cues = new Map(config.cues.map((cue) => [cue.id, cue]));
  return [
    ...SCHEDULE_ORDER.map((id) => cues.get(id)).filter((cue): cue is SenseCueConfig => !!cue),
    ...SENSE_ORDER.filter((id) => !SCHEDULE_ORDER.includes(id))
      .map((id) => cues.get(id))
      .filter((cue): cue is SenseCueConfig => !!cue),
  ];
}

export function loadExperienceConfig(): ExperienceConfig {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return cloneConfig(DEFAULT_EXPERIENCE_CONFIG);
  }

  try {
    return normalizeConfig(JSON.parse(stored));
  } catch (error) {
    console.warn("[experience] saved config is invalid; using defaults", error);
    return cloneConfig(DEFAULT_EXPERIENCE_CONFIG);
  }
}

export function saveExperienceConfig(config: ExperienceConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config), null, 2));
}

export function resetExperienceConfig(): ExperienceConfig {
  const next = cloneConfig(DEFAULT_EXPERIENCE_CONFIG);
  saveExperienceConfig(next);
  return next;
}

export function parseExperienceConfig(text: string): ExperienceConfig {
  return normalizeConfig(JSON.parse(text));
}

export function applyExperienceConfig(config: ExperienceConfig, timeSeconds: number): void {
  if (signals.senseAuthority.peek() !== "config") {
    return;
  }

  const cueById = new Map(config.cues.map((cue) => [cue.id, cue]));
  for (const id of SENSE_ORDER) {
    const cue = cueById.get(id);
    signals.sense[id].value =
      cue && cue.enabled && timeSeconds >= cue.start ? clamp01(cue.intensity) : 0;
  }
}

export function formatSenseCueLabel(cue: SenseCueConfig): string {
  return SENSE_LABELS[cue.id];
}

function normalizeConfig(input: unknown): ExperienceConfig {
  const raw = isRecord(input) ? input : {};
  const duration = clampNumber(raw["duration"], 60, 3600, DEFAULT_DURATION);
  const rawCues = Array.isArray(raw["cues"]) ? raw["cues"] : [];
  const byId = new Map<SenseId, Partial<SenseCueConfig>>();

  for (const rawCue of rawCues) {
    if (!isRecord(rawCue) || !isSenseId(rawCue["id"])) {
      continue;
    }
    byId.set(rawCue["id"], rawCue as Partial<SenseCueConfig>);
  }

  return {
    version: 1,
    duration,
    cues: SENSE_ORDER.map((id) => {
      const fallback = DEFAULT_EXPERIENCE_CONFIG.cues.find((cue) => cue.id === id);
      const rawCue = byId.get(id);
      return {
        id,
        enabled: typeof rawCue?.enabled === "boolean" ? rawCue.enabled : (fallback?.enabled ?? false),
        start: clampNumber(rawCue?.start, 0, duration, fallback?.start ?? duration),
        intensity: clampNumber(rawCue?.intensity, 0, 1, fallback?.intensity ?? 1),
      };
    }),
  };
}

function cloneConfig(config: ExperienceConfig): ExperienceConfig {
  return {
    version: 1,
    duration: config.duration,
    cues: config.cues.map((cue) => ({ ...cue })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
