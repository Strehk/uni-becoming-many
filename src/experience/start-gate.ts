/**
 * Start gate — holds the Theatre timeline (the clock) paused after the experience starts,
 * until the audience gives the go-ahead: **Enter** on the keyboard, or the **A button** on
 * an XR controller. Until then the world sits frozen at t=0 (Theatre's playhead never
 * advances), so the piece begins on the audience's cue rather than the instant the menu closes.
 *
 * Self-contained: it owns its keyboard listener and a small on-screen prompt, and it polls the
 * XR controller gamepads each frame (WebXR exposes no button event for the face buttons — only
 * the trigger fires `select`, so A is read by polling). Fires `onTrigger` exactly once, then
 * tears everything down. Lift it out early with `dispose()` if the gate is abandoned.
 *
 * The A button is `gamepad.buttons[4]` in the xr-standard mapping (A/X primary face button on
 * either hand); we accept a press on any connected controller.
 */

/** xr-standard gamepad index of the primary face button (A on the right hand, X on the left). */
const XR_BUTTON_A = 4;

export interface StartGate {
  /** Poll the XR controller gamepads for an A press; call once per frame while armed. */
  poll(): void;
  dispose(): void;
}

export interface StartGateOptions {
  /** The active XR session, or null when not presenting — read fresh each poll. */
  getSession(): XRSession | null;
  /** Invoked once, on the first Enter/A press. */
  onTrigger(): void;
}

export function createStartGate(options: StartGateOptions): StartGate {
  let triggered = false;
  const prompt = createPrompt();
  document.body.append(prompt);

  const isTyping = (): boolean => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };

  const fire = (): void => {
    if (triggered) {
      return;
    }
    triggered = true;
    window.removeEventListener("keydown", onKeyDown);
    prompt.remove();
    options.onTrigger();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping()) {
      return;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      event.preventDefault();
      fire();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    poll(): void {
      if (triggered) {
        return;
      }
      const session = options.getSession();
      if (!session) {
        return;
      }
      for (const source of session.inputSources) {
        if (source.gamepad?.buttons[XR_BUTTON_A]?.pressed) {
          fire();
          return;
        }
      }
    },
    dispose(): void {
      triggered = true;
      window.removeEventListener("keydown", onKeyDown);
      prompt.remove();
    },
  };
}

function createPrompt(): HTMLElement {
  if (!document.getElementById("start-gate-styles")) {
    const style = document.createElement("style");
    style.id = "start-gate-styles";
    style.textContent = `
      .start-gate {
        position: fixed;
        left: 50%;
        bottom: 48px;
        transform: translateX(-50%);
        z-index: 58;
        padding: 12px 22px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(12, 16, 22, 0.62);
        color: #f4f6f8;
        font: inherit;
        letter-spacing: 0.02em;
        pointer-events: none;
        animation: start-gate-pulse 2s ease-in-out infinite;
      }
      @keyframes start-gate-pulse {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }
    `;
    document.head.append(style);
  }
  const el = document.createElement("div");
  el.className = "start-gate";
  el.textContent = "Enter drücken oder A am Controller, um zu beginnen";
  return el;
}
