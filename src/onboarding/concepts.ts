// ── Becoming Many — Onboarding stagings (EXPERIMENT) ───────────
//
// Kept apart from the field itself so the menu and the settings can name a staging without
// pulling three.js in behind them. PURE DATA.

/** How the lesson runs. */
export type OnboardingConcept =
  /** The real thing: each task waits until it has actually been flown. */
  | "tutorial"
  /** Hands-off run-through at a fixed pace — for judging the look without flying. */
  | "demo";

export const ONBOARDING_CONCEPTS: readonly {
  readonly id: OnboardingConcept;
  readonly label: string;
  readonly note: string;
}[] = [
  {
    id: "tutorial",
    label: "Tutorial",
    note: "Erst wenn du die Aufgabe wirklich geflogen bist, kommt die nächste — danach beginnt das Stück.",
  },
  {
    id: "demo",
    label: "Vorführung",
    note: "Läuft von selbst durch, ohne dass du fliegen musst — nur zum Ansehen.",
  },
];

export const DEFAULT_ONBOARDING_CONCEPT: OnboardingConcept = "tutorial";

/** Narrow an unknown (a stored setting, a URL param) to a staging. */
export function asOnboardingConcept(value: unknown): OnboardingConcept | null {
  return value === "tutorial" || value === "demo" ? value : null;
}
