import {
  DEFAULT_EXPERIENCE_CONFIG,
  formatSenseCueLabel,
  orderedCues,
  parseExperienceConfig,
  resetExperienceConfig,
  saveExperienceConfig,
  type ExperienceConfig,
  type SenseCueConfig,
} from "./config.ts";
import { isSenseId } from "../senses/ids.ts";

export interface StartMenuOptions {
  config: ExperienceConfig;
  onStart(config: ExperienceConfig): void;
  onConfigure(config: ExperienceConfig): void;
  onConfigChange(config: ExperienceConfig): void;
  onTest(config: ExperienceConfig): void;
}

export interface StartMenu {
  dispose(): void;
}

export function createStartMenu(options: StartMenuOptions): StartMenu {
  injectStyles();

  let config = cloneConfig(options.config);
  let statusTimer = 0;

  const root = document.createElement("div");
  root.className = "exp-menu";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");

  const panel = document.createElement("section");
  panel.className = "exp-menu__panel";
  root.append(panel);

  const returnButton = document.createElement("button");
  returnButton.className = "exp-menu__return exp-menu__return--hidden";
  returnButton.type = "button";
  returnButton.textContent = "Konfiguration";
  returnButton.addEventListener("click", () => {
    root.classList.remove("exp-menu--hidden");
    returnButton.classList.add("exp-menu__return--hidden");
    renderConfig();
  });
  document.body.append(returnButton);
  document.body.append(root);

  const setConfig = (next: ExperienceConfig): void => {
    config = cloneConfig(next);
    options.onConfigChange(config);
  };

  const showStatus = (text: string): void => {
    const status = panel.querySelector<HTMLElement>("[data-exp-status]");
    if (!status) {
      return;
    }
    window.clearTimeout(statusTimer);
    status.textContent = text;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 2200);
  };

  const startExperience = (): void => {
    saveExperienceConfig(config);
    options.onStart(cloneConfig(config));
    root.classList.add("exp-menu--hidden");
  };

  const renderHome = (): void => {
    panel.replaceChildren();

    const title = document.createElement("h1");
    title.textContent = "Becoming Many";

    const subtitle = document.createElement("p");
    subtitle.className = "exp-menu__lede";
    subtitle.textContent = "Starten oder Ablauf, Sinn-Freischaltungen und Intensitäten konfigurieren.";

    const actions = document.createElement("div");
    actions.className = "exp-menu__actions";

    const startButton = button("Experience starten", "primary");
    startButton.addEventListener("click", startExperience);

    const configButton = button("Experience konfigurieren", "secondary");
    configButton.addEventListener("click", () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("studio") !== "1") {
        url.searchParams.set("studio", "1");
        window.location.href = url.toString();
        return;
      }
      options.onConfigure(cloneConfig(config));
      renderConfig();
    });

    actions.append(startButton, configButton);
    panel.append(title, subtitle, actions);
  };

  const renderConfig = (): void => {
    panel.replaceChildren();

    const header = document.createElement("div");
    header.className = "exp-menu__config-head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h1");
    title.textContent = "Experience konfigurieren";
    const subtitle = document.createElement("p");
    subtitle.className = "exp-menu__lede";
    subtitle.textContent = "Die Sinn-Timeline wird in Theatre.js bearbeitet. Diese Ansicht speichert nur Ablauf-Vorlagen.";
    titleWrap.append(title, subtitle);

    const backButton = button("Zurueck", "ghost");
    backButton.addEventListener("click", renderHome);
    header.append(titleWrap, backButton);

    const form = document.createElement("form");
    form.className = "exp-menu__form";

    const durationLabel = document.createElement("label");
    durationLabel.className = "exp-menu__duration";
    durationLabel.textContent = "Dauer in Sekunden";
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = "60";
    duration.max = "3600";
    duration.step = "1";
    duration.value = String(Math.round(config.duration));
    durationLabel.append(duration);

    const table = document.createElement("div");
    table.className = "exp-menu__schedule";
    table.append(scheduleHeader());
    table.append(luftRow());
    for (const cue of orderedCues(config)) {
      table.append(cueRow(cue));
    }

    const status = document.createElement("p");
    status.className = "exp-menu__status";
    status.dataset["expStatus"] = "";

    const actions = document.createElement("div");
    actions.className = "exp-menu__actions exp-menu__actions--wide";

    const saveButton = button("Speichern", "primary");
    saveButton.type = "submit";

    const saveStartButton = button("Speichern und starten", "secondary");
    saveStartButton.type = "button";
    saveStartButton.addEventListener("click", () => {
      const next = readConfig(form, duration);
      setConfig(next);
      saveExperienceConfig(next);
      startExperience();
    });

    const theatreButton = button("Theatre Timeline öffnen", "secondary");
    theatreButton.type = "button";
    theatreButton.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("studio", "1");
      window.location.href = url.toString();
    });

    const testButton = button("Test ansehen", "secondary");
    testButton.type = "button";
    testButton.addEventListener("click", () => {
      const next = readConfig(form, duration);
      setConfig(next);
      saveExperienceConfig(next);
      options.onTest(cloneConfig(next));
      root.classList.add("exp-menu--hidden");
      returnButton.classList.remove("exp-menu__return--hidden");
    });

    const resetButton = button("Standard", "ghost");
    resetButton.type = "button";
    resetButton.addEventListener("click", () => {
      const next = resetExperienceConfig();
      setConfig(next);
      renderConfig();
    });

    const exportButton = button("Export JSON", "ghost");
    exportButton.type = "button";
    exportButton.addEventListener("click", () => exportConfig(config));

    const importLabel = document.createElement("label");
    importLabel.className = "exp-menu__file";
    importLabel.textContent = "Import JSON";
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (!file) {
        return;
      }
      file
        .text()
        .then((text) => {
          const next = parseExperienceConfig(text);
          setConfig(next);
          saveExperienceConfig(next);
          renderConfig();
        })
        .catch((error) => {
          console.warn("[experience] config import failed", error);
          showStatus("Import fehlgeschlagen");
        });
    });
    importLabel.append(importInput);

    actions.append(
      theatreButton,
      saveButton,
      testButton,
      saveStartButton,
      resetButton,
      exportButton,
      importLabel,
    );
    form.append(durationLabel, table, actions, status);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = readConfig(form, duration);
      setConfig(next);
      saveExperienceConfig(next);
      showStatus("Gespeichert");
    });

    panel.append(header, form);
  };

  renderHome();

  return {
    dispose() {
      window.clearTimeout(statusTimer);
      root.remove();
      returnButton.remove();
    },
  };
}

function scheduleHeader(): HTMLElement {
  const row = document.createElement("div");
  row.className = "exp-menu__row exp-menu__row--head";
  row.append(span("Sinn"), span("Aktiv"), span("Start"), span("Intensitaet"));
  return row;
}

function luftRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "exp-menu__row exp-menu__row--locked";
  row.append(span("Luft / weiss"), span("immer"), span("0 s"), span("Basis"));
  return row;
}

function cueRow(cue: SenseCueConfig): HTMLElement {
  const row = document.createElement("div");
  row.className = "exp-menu__row";
  row.dataset["senseId"] = cue.id;

  const name = span(formatSenseCueLabel(cue));

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.name = "enabled";
  enabled.checked = cue.enabled;
  enabled.setAttribute("aria-label", `${formatSenseCueLabel(cue)} aktiv`);

  const start = document.createElement("input");
  start.type = "number";
  start.name = "start";
  start.min = "0";
  start.max = String(DEFAULT_EXPERIENCE_CONFIG.duration);
  start.step = "0.1";
  start.value = trimNumber(cue.start);
  start.setAttribute("aria-label", `${formatSenseCueLabel(cue)} Startzeit`);

  const intensity = document.createElement("input");
  intensity.type = "number";
  intensity.name = "intensity";
  intensity.min = "0";
  intensity.max = "1";
  intensity.step = "0.01";
  intensity.value = trimNumber(cue.intensity);
  intensity.setAttribute("aria-label", `${formatSenseCueLabel(cue)} Intensitaet`);

  row.append(name, wrap(enabled), wrap(start), wrap(intensity));
  return row;
}

function readConfig(form: HTMLFormElement, durationInput: HTMLInputElement): ExperienceConfig {
  const duration = clampNumber(durationInput.valueAsNumber, 60, 3600, 300);
  const cues: SenseCueConfig[] = [];

  for (const row of form.querySelectorAll<HTMLElement>("[data-sense-id]")) {
    const id = row.dataset["senseId"];
    const enabled = row.querySelector<HTMLInputElement>('input[name="enabled"]');
    const start = row.querySelector<HTMLInputElement>('input[name="start"]');
    const intensity = row.querySelector<HTMLInputElement>('input[name="intensity"]');
    if (!isSenseId(id) || !enabled || !start || !intensity) {
      continue;
    }
    cues.push({
      id,
      enabled: enabled.checked,
      start: clampNumber(start.valueAsNumber, 0, duration, 0),
      intensity: clampNumber(intensity.valueAsNumber, 0, 1, 1),
    });
  }

  return { version: 1, duration, cues };
}

function exportConfig(config: ExperienceConfig): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "becoming-many-config.json";
  link.click();
  URL.revokeObjectURL(url);
}

function button(label: string, variant: "primary" | "secondary" | "ghost"): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `exp-menu__button exp-menu__button--${variant}`;
  el.textContent = label;
  return el;
}

function span(text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

function wrap(child: HTMLElement): HTMLSpanElement {
  const el = document.createElement("span");
  el.append(child);
  return el;
}

function cloneConfig(config: ExperienceConfig): ExperienceConfig {
  return {
    version: 1,
    duration: config.duration,
    cues: config.cues.map((cue) => ({ ...cue })),
  };
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function injectStyles(): void {
  if (document.getElementById("experience-menu-styles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "experience-menu-styles";
  style.textContent = `
    .exp-menu {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(5, 8, 12, 0.82);
      color: #f4f6f8;
    }

    .exp-menu--hidden {
      display: none;
    }

    .exp-menu__return {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 59;
      min-height: 36px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      padding: 0 12px;
      background: rgba(18, 22, 28, 0.92);
      color: #f4f6f8;
      font: inherit;
      cursor: pointer;
    }

    .exp-menu__return--hidden {
      display: none;
    }

    .exp-menu__panel {
      width: min(920px, 100%);
      max-height: min(760px, calc(100vh - 48px));
      overflow: auto;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: rgba(18, 22, 28, 0.96);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
      padding: 28px;
    }

    .exp-menu h1 {
      font-size: 28px;
      line-height: 1.1;
      font-weight: 650;
      margin: 0;
    }

    .exp-menu__lede {
      margin-top: 10px;
      color: #cbd5df;
      line-height: 1.45;
      max-width: 680px;
    }

    .exp-menu__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }

    .exp-menu__actions--wide {
      margin-top: 18px;
    }

    .exp-menu__button,
    .exp-menu__file {
      min-height: 40px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.08);
      color: #f4f6f8;
      font: inherit;
      cursor: pointer;
    }

    .exp-menu__button--primary {
      border-color: #d9f99d;
      background: #d9f99d;
      color: #111827;
      font-weight: 650;
    }

    .exp-menu__button--secondary {
      border-color: rgba(125, 211, 252, 0.7);
      background: rgba(125, 211, 252, 0.16);
    }

    .exp-menu__button--ghost,
    .exp-menu__file {
      background: rgba(255, 255, 255, 0.04);
    }

    .exp-menu__file input {
      display: none;
    }

    .exp-menu__config-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .exp-menu__form {
      margin-top: 20px;
    }

    .exp-menu__duration {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #d8dee8;
    }

    .exp-menu input[type="number"] {
      width: 96px;
      min-height: 34px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.24);
      color: #f4f6f8;
      padding: 0 10px;
      font: inherit;
    }

    .exp-menu input[type="checkbox"] {
      width: 20px;
      height: 20px;
      accent-color: #d9f99d;
    }

    .exp-menu__schedule {
      display: grid;
      gap: 1px;
      margin-top: 18px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
    }

    .exp-menu__row {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) 86px 116px 116px;
      gap: 12px;
      align-items: center;
      min-height: 48px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.055);
    }

    .exp-menu__row--head {
      min-height: 36px;
      background: rgba(255, 255, 255, 0.12);
      color: #e5e7eb;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .exp-menu__row--locked {
      color: #cbd5df;
      background: rgba(255, 255, 255, 0.035);
    }

    .exp-menu__status {
      min-height: 22px;
      margin-top: 12px;
      color: #d9f99d;
    }

    @media (max-width: 680px) {
      .exp-menu {
        padding: 12px;
      }

      .exp-menu__panel {
        padding: 18px;
        max-height: calc(100vh - 24px);
      }

      .exp-menu__config-head {
        flex-direction: column;
      }

      .exp-menu__row {
        grid-template-columns: minmax(120px, 1fr) 62px 88px 88px;
        gap: 8px;
        padding: 8px;
      }

      .exp-menu input[type="number"] {
        width: 78px;
      }
    }
  `;
  document.head.append(style);
}
