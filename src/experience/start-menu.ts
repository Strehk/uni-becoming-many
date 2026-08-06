// ── Becoming Many — Start menu ───────────────────────────────────
//
// The frame around the piece: the first thing shown and the last thing touched
// before the flight begins. Three screens behind one opaque surface —
//
//   • **Start** — the title and a game-menu list: begin, begin on a phone, settings,
//     and (quietly, for the operator) the dramaturgy editor.
//   • **Einstellungen** — quality and steering. The audience-facing half of what the
//     C-console Performance panel offers, reduced to the four presets, plus the
//     control scheme and the gyro tuning the mobile mode needs.
//   • **Ablauf** — the sense schedule; unchanged in substance, restyled to match.
//
// The surface is opaque (see menu-theme.ts): the world is neither visible nor drawn
// behind it — `onVisibleChange` lets the host pause the render pass — so the
// settings can be read calmly and a phone is not rendering a WebGPU frame under a
// menu it cannot see.

import { PRESETS } from "../perf/presets.ts";
import { CUSTOM_PRESET_ID, type PerfRouter } from "../perf/router.ts";
import { isSenseId } from "../senses/ids.ts";
import {
  DEFAULT_EXPERIENCE_CONFIG,
  type ExperienceConfig,
  type SenseCueConfig,
  formatSenseCueLabel,
  orderedCues,
  parseExperienceConfig,
  resetExperienceConfig,
  saveExperienceConfig,
} from "./config.ts";
import { injectMenuTheme } from "./menu-theme.ts";
import {
  type AppSettings,
  type ExperienceMode,
  MODE_LABELS,
  MODE_NOTES,
  looksLikeMobile,
  supportsDeviceOrientation,
} from "./settings.ts";

export interface StartMenuOptions {
  config: ExperienceConfig;
  settings: AppSettings;
  /** Quality routing — the Einstellungen screen applies presets through it. */
  router: PerfRouter;
  /** Persist and apply a settings change (control scheme, gyro tuning, quality). */
  onSettingsChange(settings: AppSettings): void;
  /**
   * Begin the piece in one of the three modes. The host does whatever that mode
   * needs first — tilt permission, fullscreen, the landscape lock — and resolves
   * false if any of it was refused, in which case the menu stays up and says so.
   */
  onStart(config: ExperienceConfig, mode: ExperienceMode): Promise<boolean>;
  /** Re-take the phone's current pose as "fly straight". */
  onCalibrate(): void;
  /** Menu shown / hidden — the host pauses drawing the world while it is up. */
  onVisibleChange(visible: boolean): void;
  onConfigure(config: ExperienceConfig): void;
  onConfigChange(config: ExperienceConfig): void;
  onTest(config: ExperienceConfig): void;
}

export interface StartMenu {
  dispose(): void;
}

export function createStartMenu(options: StartMenuOptions): StartMenu {
  injectMenuTheme();

  let config = cloneConfig(options.config);
  let settings: AppSettings = { ...options.settings };
  let statusTimer = 0;

  const root = document.createElement("div");
  root.className = "bm-menu";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");

  const screen = document.createElement("section");
  screen.className = "bm-menu__screen";
  root.append(screen);

  const returnButton = document.createElement("button");
  returnButton.className = "bm-menu-return";
  returnButton.type = "button";
  returnButton.hidden = true;
  returnButton.textContent = "Konfiguration";
  returnButton.addEventListener("click", () => {
    setVisible(true);
    returnButton.hidden = true;
    renderConfig();
  });

  document.body.append(returnButton, root);

  /** Show or hide the whole surface, telling the host so it can pause the world. */
  function setVisible(visible: boolean): void {
    root.hidden = !visible;
    options.onVisibleChange(visible);
  }
  options.onVisibleChange(true);

  const setSettings = (next: AppSettings): void => {
    settings = { ...next };
    options.onSettingsChange(settings);
  };

  const setConfig = (next: ExperienceConfig): void => {
    config = cloneConfig(next);
    options.onConfigChange(config);
  };

  const showStatus = (text: string): void => {
    const status = screen.querySelector<HTMLElement>("[data-bm-status]");
    if (!status) {
      return;
    }
    window.clearTimeout(statusTimer);
    status.textContent = text;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 3200);
  };

  /**
   * Begin in `mode`. Everything that can be refused — the tilt sensor, fullscreen —
   * lives on the host side of `onStart`, and this very click is the user gesture all
   * of it needs, so nothing may be deferred past it.
   */
  const startExperience = async (
    mode: ExperienceMode,
    button: HTMLButtonElement,
  ): Promise<void> => {
    button.disabled = true;
    const started = await options.onStart(cloneConfig(config), mode);
    button.disabled = false;
    if (!started) {
      return; // the host explains why in the note line
    }
    saveExperienceConfig(config);
    setVisible(false);
  };

  // ── Screen: start ──────────────────────────────────────────────
  function renderHome(): void {
    screen.replaceChildren();
    screen.classList.remove("bm-menu__screen--wide");

    const head = document.createElement("div");
    head.className = "bm-menu__head";
    const title = document.createElement("h1");
    title.className = "bm-menu__title";
    title.textContent = "Becoming Many";
    const lede = document.createElement("p");
    lede.className = "bm-menu__lede";
    lede.textContent = "Ein Flug durch die Sinne anderer Lebewesen.";
    head.append(title, lede);

    const list = document.createElement("div");
    list.className = "bm-menu__list";

    const note = document.createElement("p");
    note.className = "bm-menu__note";
    note.dataset["bmStatus"] = "";

    /** The hovered entry explains itself in the shared note line below the list. */
    const entry = (
      label: string,
      hint: string,
      variant: "primary" | "normal" | "quiet",
      onClick: () => void,
    ): HTMLButtonElement => {
      const button = menuItem(label, variant);
      button.addEventListener("click", onClick);
      const show = (): void => {
        note.textContent = hint;
      };
      const clear = (): void => {
        note.textContent = "";
      };
      button.addEventListener("pointerenter", show);
      button.addEventListener("focus", show);
      button.addEventListener("pointerleave", clear);
      button.addEventListener("blur", clear);
      return button;
    };

    // On a touch device the phone flight is the obvious way in, so it leads.
    const onTouch = looksLikeMobile();
    const order: ExperienceMode[] = onTouch
      ? ["mobile", "desktop", "icaros"]
      : ["desktop", "mobile", "icaros"];

    const starts = order.map((mode, index) => {
      const button = entry(
        `${MODE_LABELS[mode]} starten`,
        MODE_NOTES[mode],
        index === 0 ? "primary" : "normal",
        () => {
          void startExperience(mode, button);
        },
      );
      if (mode === "mobile" && !supportsDeviceOrientation()) {
        button.disabled = true;
        button.title = "Dieses Gerät meldet keine Neigung.";
      }
      return button;
    });

    const settingsEntry = entry(
      "Einstellungen",
      "Qualität und Steuerung — ohne dass die Welt im Hintergrund läuft.",
      "normal",
      renderSettings,
    );

    const configure = entry(
      "Ablauf konfigurieren",
      "Für die Betreuung: wann welcher Sinn erwacht.",
      "quiet",
      () => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("studio") !== "1") {
          url.searchParams.set("studio", "1");
          window.location.href = url.toString();
          return;
        }
        options.onConfigure(cloneConfig(config));
        renderConfig();
      },
    );

    list.append(...starts, settingsEntry, configure);
    screen.append(head, list, note);
  }

  // ── Screen: settings ───────────────────────────────────────────
  function renderSettings(): void {
    screen.replaceChildren();
    screen.classList.remove("bm-menu__screen--wide");

    const head = document.createElement("div");
    head.className = "bm-menu__head";
    const title = document.createElement("h1");
    title.className = "bm-menu__title bm-menu__title--small";
    title.textContent = "Einstellungen";
    const lede = document.createElement("p");
    lede.className = "bm-menu__lede";
    lede.textContent =
      "Gelten sofort und bleiben auf diesem Gerät gespeichert. Der Modus wird auf dem Startbild gewählt.";
    head.append(title, lede);

    const sections = document.createElement("div");
    sections.className = "bm-menu__sections";
    sections.append(qualitySection(), controlSection());

    const status = document.createElement("p");
    status.className = "bm-menu__status";
    status.dataset["bmStatus"] = "";

    const back = menuItem("Zurück", "normal");
    back.addEventListener("click", renderHome);

    screen.append(head, sections, status, back);
  }

  function qualitySection(): HTMLElement {
    const section = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "bm-menu__section-title";
    title.textContent = "Qualität";

    const choices = document.createElement("div");
    choices.className = "bm-menu__choices";
    const buttons = new Map<string, HTMLButtonElement>();

    const mark = (id: string): void => {
      for (const [pid, btn] of buttons) {
        btn.setAttribute("aria-pressed", String(pid === id));
      }
    };

    for (const preset of PRESETS) {
      const button = choiceButton(preset.label, preset.note);
      button.addEventListener("click", () => {
        options.router.applyPreset(preset);
        setSettings({ ...settings, quality: preset.id });
        mark(preset.id);
        showStatus(`Qualität: ${preset.label}`);
      });
      buttons.set(preset.id, button);
      choices.append(button);
    }

    mark(settings.quality);
    section.append(title, choices);

    // The C console can leave the tuning between two presets; say so rather than
    // lighting up a preset that no longer describes what is running.
    if (settings.quality === CUSTOM_PRESET_ID) {
      const custom = document.createElement("p");
      custom.className = "bm-menu__status";
      custom.textContent =
        "Zurzeit gilt die eingebaute Feinabstimmung — eine Stufe wählen ersetzt sie.";
      section.append(custom);
    }

    return section;
  }

  /**
   * Steering settings. Only the mobile mode has anything to tune — the keyboard and
   * the ICAROS host bring their own feel — so this section is about the phone, and
   * says so rather than offering a mode picker that the start screen already is.
   */
  function controlSection(): HTMLElement {
    const section = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "bm-menu__section-title";
    title.textContent = "Steuerung am Handy";

    const rows = document.createElement("div");
    rows.className = "bm-menu__rows";

    const sensitivity = document.createElement("label");
    sensitivity.className = "bm-menu__row";
    const sensitivityText = document.createElement("span");
    sensitivityText.textContent = "Empfindlichkeit";
    const sensitivityValue = document.createElement("span");
    sensitivityValue.className = "bm-menu__value";
    const sensitivityInput = document.createElement("input");
    sensitivityInput.type = "range";
    // Stored is the tilt angle that counts as full deflection, so a *smaller* angle is
    // the sharper setting — the reverse of how a sensitivity slider should read. The
    // control is therefore mirrored: dragging right always means "reacts sooner".
    sensitivityInput.min = String(GYRO_RANGE_MIN);
    sensitivityInput.max = String(GYRO_RANGE_MAX);
    sensitivityInput.step = "2";
    sensitivityInput.value = String(mirrorRange(settings.gyroRangeDegrees));
    sensitivityValue.textContent = `${settings.gyroRangeDegrees}°`;
    sensitivityInput.addEventListener("input", () => {
      const degrees = mirrorRange(Number.parseFloat(sensitivityInput.value));
      sensitivityValue.textContent = `${degrees}°`;
      setSettings({ ...settings, gyroRangeDegrees: degrees });
    });
    sensitivity.append(sensitivityText, sensitivityInput, sensitivityValue);

    const invert = document.createElement("label");
    invert.className = "bm-menu__row";
    const invertText = document.createElement("span");
    invertText.textContent = "Steigen und Sinken vertauschen";
    const invertInput = document.createElement("input");
    invertInput.type = "checkbox";
    invertInput.checked = settings.gyroInvertPitch;
    invertInput.addEventListener("change", () => {
      setSettings({ ...settings, gyroInvertPitch: invertInput.checked });
    });
    invert.append(invertText, invertInput);

    const calibrate = document.createElement("div");
    calibrate.className = "bm-menu__row";
    const calibrateText = document.createElement("span");
    calibrateText.textContent = "Neutrale Haltung";
    const calibrateButton = document.createElement("button");
    calibrateButton.type = "button";
    calibrateButton.className = "bm-menu__small";
    calibrateButton.textContent = "Jetzt festlegen";
    calibrateButton.addEventListener("click", () => {
      options.onCalibrate();
      showStatus("Die aktuelle Haltung gilt jetzt als Geradeausflug.");
    });
    calibrate.append(calibrateText, calibrateButton);

    rows.append(sensitivity, invert, calibrate);
    section.append(title, rows);

    if (!supportsDeviceOrientation()) {
      const hint = document.createElement("p");
      hint.className = "bm-menu__status";
      hint.textContent = "Dieses Gerät meldet keine Neigung — die Werte gelten auf dem Handy.";
      section.append(hint);
    }

    return section;
  }

  // ── Screen: dramaturgy ─────────────────────────────────────────
  function renderConfig(): void {
    screen.replaceChildren();
    screen.classList.add("bm-menu__screen--wide");

    const head = document.createElement("div");
    head.className = "bm-menu__head";
    const title = document.createElement("h1");
    title.className = "bm-menu__title bm-menu__title--small";
    title.textContent = "Ablauf";
    const lede = document.createElement("p");
    lede.className = "bm-menu__lede";
    lede.textContent =
      "Die Sinn-Timeline wird in Theatre.js bearbeitet. Diese Ansicht speichert nur Ablauf-Vorlagen.";
    head.append(title, lede);

    const form = document.createElement("form");
    form.className = "bm-menu__form";

    const durationLabel = document.createElement("label");
    durationLabel.className = "bm-menu__duration";
    durationLabel.append(document.createTextNode("Dauer in Sekunden"));
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = "60";
    duration.max = "3600";
    duration.step = "1";
    duration.value = String(Math.round(config.duration));
    durationLabel.append(duration);

    const table = document.createElement("div");
    table.className = "bm-menu__schedule";
    table.append(scheduleHeader(), luftRow());
    for (const cue of orderedCues(config)) {
      table.append(cueRow(cue));
    }

    const status = document.createElement("p");
    status.className = "bm-menu__status";
    status.dataset["bmStatus"] = "";

    const actions = document.createElement("div");
    actions.className = "bm-menu__actions";

    const saveButton = smallButton("Speichern");
    saveButton.type = "submit";

    const saveStartButton = smallButton("Speichern und starten");
    saveStartButton.addEventListener("click", () => {
      const next = readConfig(form, duration);
      setConfig(next);
      saveExperienceConfig(next);
      void startExperience(settings.mode, saveStartButton);
    });

    const theatreButton = smallButton("Theatre Timeline öffnen");
    theatreButton.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("studio", "1");
      window.location.href = url.toString();
    });

    const testButton = smallButton("Test ansehen");
    testButton.addEventListener("click", () => {
      const next = readConfig(form, duration);
      setConfig(next);
      saveExperienceConfig(next);
      options.onTest(cloneConfig(next));
      setVisible(false);
      returnButton.hidden = false;
    });

    const resetButton = smallButton("Standard");
    resetButton.addEventListener("click", () => {
      const next = resetExperienceConfig();
      setConfig(next);
      renderConfig();
    });

    const exportButton = smallButton("Export JSON");
    exportButton.addEventListener("click", () => exportConfig(config));

    const importLabel = document.createElement("label");
    importLabel.className = "bm-menu__small bm-menu__file";
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

    const back = menuItem("Zurück", "quiet");
    back.addEventListener("click", renderHome);

    screen.append(head, form, back);
  }

  renderHome();

  return {
    dispose() {
      window.clearTimeout(statusTimer);
      root.remove();
      returnButton.remove();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

/** Bounds of the gyro range slider, in degrees of tilt. */
const GYRO_RANGE_MIN = 10;
const GYRO_RANGE_MAX = 50;

/** Mirror a value inside the slider's range — its own inverse, both ways. */
function mirrorRange(value: number): number {
  return GYRO_RANGE_MIN + GYRO_RANGE_MAX - value;
}

function menuItem(label: string, variant: "primary" | "normal" | "quiet"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bm-menu__item";
  if (variant !== "normal") {
    button.classList.add(`bm-menu__item--${variant}`);
  }
  button.textContent = label;
  return button;
}

function choiceButton(label: string, note: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bm-menu__choice";
  button.setAttribute("aria-pressed", "false");
  const labelEl = document.createElement("span");
  labelEl.className = "bm-menu__choice-label";
  labelEl.textContent = label;
  const noteEl = document.createElement("span");
  noteEl.className = "bm-menu__choice-note";
  noteEl.textContent = note;
  button.append(labelEl, noteEl);
  return button;
}

function smallButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bm-menu__small";
  button.textContent = label;
  return button;
}

function scheduleHeader(): HTMLElement {
  const row = document.createElement("div");
  row.className = "bm-menu__srow bm-menu__srow--head";
  row.append(span("Sinn"), span("Aktiv"), span("Start"), span("Intensität"));
  return row;
}

function luftRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "bm-menu__srow bm-menu__srow--locked";
  row.append(span("Luft / weiss"), span("immer"), span("0 s"), span("Basis"));
  return row;
}

function cueRow(cue: SenseCueConfig): HTMLElement {
  const row = document.createElement("div");
  row.className = "bm-menu__srow";
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
  intensity.setAttribute("aria-label", `${formatSenseCueLabel(cue)} Intensität`);

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
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
