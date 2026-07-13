import type { DevConsole } from "../dev-console/index.ts";

export type ExperienceInterfaceMode = "menu" | "playback" | "configure";

export interface InterfaceModeController {
  setMode(mode: ExperienceInterfaceMode): void;
  dispose(): void;
}

export interface InterfaceModeOptions {
  devConsole: DevConsole;
  inspectorElement: HTMLElement;
  vrButton: HTMLElement;
  debugEnabled?: boolean;
  setSynthOpen?: (open: boolean) => void;
  onSynthOpenChange?: (cb: (open: boolean) => void) => () => void;
}

const STYLE_ID = "experience-interface-mode-styles";

export function createInterfaceModeController(
  options: InterfaceModeOptions,
): InterfaceModeController {
  injectStyles();

  let currentMode: ExperienceInterfaceMode = "menu";
  let devPanelOpen = false;
  let synthPanelOpen = false;
  let inspectorParent: Node | null = options.inspectorElement.parentNode;
  let inspectorNext: ChildNode | null = options.inspectorElement.nextSibling;

  const shell = document.createElement("div");
  shell.className = "bm-config-shell";
  shell.hidden = true;
  shell.setAttribute("aria-label", "Konfiguration");

  const title = document.createElement("span");
  title.className = "bm-config-shell__title";
  title.textContent = "Konfiguration";

  const timeline = shellButton("Timeline", () => showConfigPanel("timeline"));

  const settings = shellButton("Sinne & Welt", () => showConfigPanel("settings"));

  const synth = shellButton("Synth", () => showConfigPanel("synth"));

  shell.append(title, timeline, settings, synth);

  const debug = shellButton("Render Debug", () => {
    setInspectorVisible(!options.inspectorElement.parentNode);
  });
  if (options.debugEnabled === true) {
    shell.append(debug);
  }

  document.body.append(shell);

  const updateActiveButton = (): void => {
    timeline.classList.toggle("active", !devPanelOpen && !synthPanelOpen);
    settings.classList.toggle("active", devPanelOpen);
    synth.classList.toggle("active", synthPanelOpen);
  };

  function showConfigPanel(panel: "timeline" | "settings" | "synth"): void {
    if (panel !== "settings") {
      options.devConsole.setOpen(false);
      setPanelAvailable(".devc-drawer", false);
    }
    if (panel !== "synth") {
      options.setSynthOpen?.(false);
      setPanelAvailable(".synth-drawer", false);
    }
    if (panel === "settings") {
      setPanelAvailable(".devc-drawer", true);
      options.devConsole.setOpen(true);
    }
    if (panel === "synth") {
      setPanelAvailable(".synth-drawer", true);
      options.setSynthOpen?.(true);
    }
    updateActiveButton();
  }

  const setInspectorVisible = (visible: boolean): void => {
    if (visible) {
      if (!options.inspectorElement.parentNode) {
        inspectorParent?.insertBefore(options.inspectorElement, inspectorNext);
      }
      options.inspectorElement.hidden = false;
      options.inspectorElement.removeAttribute("inert");
      options.inspectorElement.setAttribute("aria-hidden", "false");
    } else {
      if (options.inspectorElement.parentNode) {
        inspectorParent = options.inspectorElement.parentNode;
        inspectorNext = options.inspectorElement.nextSibling;
        options.inspectorElement.remove();
      }
      options.inspectorElement.hidden = true;
      options.inspectorElement.toggleAttribute("inert", true);
      options.inspectorElement.setAttribute("aria-hidden", "true");
    }
  };

  const setElementHidden = (selector: string, hidden: boolean): void => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      el.hidden = hidden;
      el.toggleAttribute("inert", hidden);
      el.setAttribute("aria-hidden", String(hidden));
    }
  };

  const setPanelAvailable = (selector: string, available: boolean): void => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      el.hidden = !available;
      el.toggleAttribute("inert", !available);
      el.setAttribute("aria-hidden", String(!available));
    }
  };

  const setAppToolsVisible = (visible: boolean): void => {
    options.vrButton.style.display = visible ? "" : "none";
    for (const el of document.querySelectorAll<HTMLElement>("#VRButton")) {
      el.hidden = !visible;
      el.toggleAttribute("inert", !visible);
      el.setAttribute("aria-hidden", String(!visible));
    }
    setElementHidden(".devc-tab, .synth-tab", !visible);
    setPanelAvailable(".devc-drawer, .synth-drawer", visible);
  };

  const offDevOpen = options.devConsole.onOpenChange((open) => {
    devPanelOpen = open;
    if (currentMode === "configure" && !open) {
      setPanelAvailable(".devc-drawer", false);
    }
    updateActiveButton();
  });

  const offSynthOpen = options.onSynthOpenChange?.((open) => {
    synthPanelOpen = open;
    if (currentMode === "configure" && !open) {
      setPanelAvailable(".synth-drawer", false);
    }
    updateActiveButton();
  });

  const setMode = (mode: ExperienceInterfaceMode): void => {
    currentMode = mode;
    document.body.dataset["experienceMode"] = mode;
    const configureMode = mode === "configure";
    document.body.classList.toggle("bm-ui-hidden", !configureMode);
    document.body.classList.toggle("bm-configure-mode", configureMode);
    shell.hidden = !configureMode;

    if (configureMode) {
      setElementHidden(".devc-tab, .synth-tab, #VRButton", true);
      options.devConsole.setOpen(false);
      options.setSynthOpen?.(false);
      setPanelAvailable(".devc-drawer, .synth-drawer", false);
      setInspectorVisible(false);
      updateActiveButton();
      return;
    }

    options.devConsole.setOpen(false);
    options.setSynthOpen?.(false);
    setAppToolsVisible(false);
    setInspectorVisible(false);
    updateActiveButton();
  };

  const restoreAll = (): void => {
    setAppToolsVisible(true);
    setInspectorVisible(true);
    if (options.debugEnabled === true) {
      options.devConsole.setOpen(true);
    }
  };

  setMode("menu");

  return {
    setMode,
    dispose() {
      document.body.classList.remove("bm-ui-hidden");
      document.body.classList.remove("bm-configure-mode");
      document.body.removeAttribute("data-experience-mode");
      shell.remove();
      offDevOpen();
      offSynthOpen?.();
      restoreAll();
    },
  };
}

function shellButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bm-config-shell__button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .bm-ui-hidden .devc-tab,
    .bm-ui-hidden .devc-drawer,
    .bm-ui-hidden .synth-tab,
    .bm-ui-hidden .synth-drawer,
    .bm-ui-hidden #VRButton {
      display: none !important;
    }

    .bm-configure-mode .devc-tab {
      display: none !important;
    }

    .bm-configure-mode .synth-tab,
    .bm-configure-mode #VRButton {
      display: none !important;
    }

    .bm-config-shell {
      position: fixed;
      top: 12px;
      right: 16px;
      z-index: 10020;
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 4px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      background: rgba(10, 13, 18, 0.9);
      color: #e5e7eb;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.28);
    }

    .bm-config-shell[hidden] {
      display: none !important;
    }

    .bm-config-shell__title {
      padding: 0 8px;
      color: #7fd4e8;
      font-weight: 700;
      letter-spacing: 0;
    }

    .bm-config-shell__button {
      min-height: 28px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 6px;
      background: rgba(255,255,255,0.06);
      color: #e5e7eb;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
    }

    .bm-config-shell__button:hover,
    .bm-config-shell__button.active {
      border-color: rgba(125, 211, 252, 0.75);
      color: #7fd4e8;
    }
  `;
  document.head.append(style);
}
