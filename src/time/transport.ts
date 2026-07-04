/**
 * Transport — keyboard control of the {@link Clock}, for authoring/debugging (the lightweight
 * form of the "transport strip" in docs/time-signals-theatre-plan.md §6). Lets you drive the one
 * spine by hand so pause/seek/timeScale are observable while tuning.
 *
 * Bindings (chosen to avoid the flight keys W/A/S/D, Shift, Space and the dev-console `C`):
 *   - K            → pause / resume the clock
 *   - J / L        → seek −5s / +5s
 *   - , / .        → timeScale ×0.5 / ×2  (clamped to 0.125 … 8)
 *   - 0            → reset the timeline to t=0
 *
 * Self-contained: attaches its own listener and lifts out with `dispose()`. Ignores keystrokes
 * while typing in a field, and stays clear of the sense keys (1–7) handled by the senses module.
 */
import type { Clock } from "./clock.ts";

export interface Transport {
  dispose(): void;
}

const SEEK_STEP = 5; // seconds
const SCALE_MIN = 0.125;
const SCALE_MAX = 8;

export function createTransport(clock: Clock, target: Window | HTMLElement = window): Transport {
  const isTyping = (): boolean => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping()) {
      return;
    }
    switch (event.code) {
      case "KeyK":
        clock.toggle();
        break;
      case "KeyJ":
        clock.seek(Math.max(0, clock.now - SEEK_STEP));
        break;
      case "KeyL":
        clock.seek(clock.now + SEEK_STEP);
        break;
      case "Comma":
        clock.timeScale = Math.max(SCALE_MIN, clock.timeScale * 0.5);
        break;
      case "Period":
        clock.timeScale = Math.min(SCALE_MAX, clock.timeScale * 2);
        break;
      case "Digit0":
        clock.reset();
        break;
      default:
        return; // not ours — leave it alone (and don't preventDefault)
    }
    event.preventDefault();
  };

  const listener = target as EventTarget;
  listener.addEventListener("keydown", onKeyDown as EventListener);

  return {
    dispose(): void {
      listener.removeEventListener("keydown", onKeyDown as EventListener);
    },
  };
}
