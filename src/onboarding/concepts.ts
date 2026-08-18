// ── Becoming Many — Onboarding concepts (EXPERIMENT) ───────────
//
// The catalogue of stagings, kept apart from the field itself so the menu and the settings
// can name a concept without pulling three.js in behind them. PURE DATA.

/** Which staging of the wordless flight lesson runs. */
export type OnboardingConcept = "zeichen" | "strom" | "tor";

export const ONBOARDING_CONCEPTS: readonly {
  readonly id: OnboardingConcept;
  readonly label: string;
  readonly note: string;
}[] = [
  {
    id: "zeichen",
    label: "Zeichen",
    note: "Der Staub sammelt sich zu Pfeilen und einem Ring, hält kurz und löst sich wieder auf.",
  },
  {
    id: "strom",
    label: "Strom",
    note: "Kein Symbol — die Luft zieht in die Richtung, in die du steuern sollst.",
  },
  {
    id: "tor",
    label: "Tore",
    note: "Ringe stehen im Raum. Fliege hindurch, dann erscheint der nächste.",
  },
];

export const DEFAULT_ONBOARDING_CONCEPT: OnboardingConcept = "zeichen";

/** Narrow an unknown (a stored setting, a URL param) to a concept. */
export function asOnboardingConcept(value: unknown): OnboardingConcept | null {
  return value === "zeichen" || value === "strom" || value === "tor" ? value : null;
}
