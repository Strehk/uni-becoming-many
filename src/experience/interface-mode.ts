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
}

const STYLE_ID = "experience-interface-mode-styles";

export function createInterfaceModeController(options: InterfaceModeOptions): InterfaceModeController {
  injectStyles();

  let inspectorParent: Node | null = options.inspectorElement.parentNode;
  let inspectorNext: ChildNode | null = options.inspectorElement.nextSibling;

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

  const setAppToolsVisible = (visible: boolean): void => {
    options.vrButton.style.display = visible ? "" : "none";
    for (const el of document.querySelectorAll<HTMLElement>(
      ".devc-tab, .devc-drawer, .synth-tab, .synth-drawer, #VRButton",
    )) {
      el.hidden = !visible;
      el.toggleAttribute("inert", !visible);
      el.setAttribute("aria-hidden", String(!visible));
    }
  };

  const setDevTabLabel = (configureMode: boolean): void => {
    const tab = document.querySelector<HTMLButtonElement>(".devc-tab");
    if (!tab) {
      return;
    }
    tab.textContent = configureMode ? "Einstellungen" : "C";
    tab.title = configureMode ? "Einstellungen" : "Dev console (C)";
  };

  const setMode = (mode: ExperienceInterfaceMode): void => {
    document.body.dataset["experienceMode"] = mode;
    const configureMode = mode === "configure";
    const showRenderDebug = configureMode && options.debugEnabled === true;
    document.body.classList.toggle("bm-ui-hidden", !configureMode);
    document.body.classList.toggle("bm-configure-mode", configureMode);
    setDevTabLabel(configureMode);

    if (configureMode) {
      setAppToolsVisible(true);
      setInspectorVisible(showRenderDebug);
      if (showRenderDebug) {
        options.devConsole.setOpen(true);
      } else {
        options.devConsole.setOpen(false);
      }
      return;
    }

    options.devConsole.setOpen(false);
    setAppToolsVisible(false);
    setInspectorVisible(false);
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
      delete document.body.dataset["experienceMode"];
      setDevTabLabel(false);
      restoreAll();
    },
  };
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
      width: 104px;
      padding: 0 10px;
      text-align: center;
    }
  `;
  document.head.append(style);
}
