/**
 * SenseDirector — the one writer of the per-sense intensity signals (manual path).
 *
 * Everything that wants to switch a sense on/off speaks a bus command; nothing writes
 * `signals.sense[id]` directly except this director and the Theatre bridge (which is
 * gated by `signals.senseAuthority === "theatre"`). The director:
 *
 *   - listens for the manual commands
 *       `sense:set    { id, value }`   set a layer intensity 0..1
 *       `sense:toggle { id }`          0 ↔ 1
 *       `sense:solo   { id }`          this layer to 1, all others to 0
 *       `sense:clear  {}`              all layers to 0
 *     Any manual command flips `senseAuthority` to "manual" so a running Theatre
 *     timeline stops overwriting what a tester just pressed.
 *   - recomputes the dominant sense (highest intensity, "none" when silent) into
 *     `signals.activeSense` whenever ANY sense cell changes — regardless of who wrote
 *     it — so the atmosphere look follows Theatre and manual control alike.
 *   - mirrors every change onto the bus as `sense:changed { id, value }` so objects
 *     and audio can react without subscribing to nine signals.
 */
import type { Bus } from "../signals/index.ts";
import { signals } from "../signals/index.ts";
import { SENSE_ORDER, type SenseId, isSenseId } from "./ids.ts";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function readCommand(payload: unknown): { id: SenseId; value?: number } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const id = "id" in payload ? payload.id : undefined;
  if (!isSenseId(id)) {
    return null;
  }
  const value = "value" in payload ? payload.value : undefined;
  return typeof value === "number" ? { id, value } : { id };
}

export interface SenseDirector {
  dispose(): void;
}

export function createSenseDirector(bus: Bus): SenseDirector {
  const unsubscribes: (() => void)[] = [];

  const recomputeDominant = (): void => {
    let best: SenseId | "none" = "none";
    let bestValue = 0;
    for (const id of SENSE_ORDER) {
      const v = signals.sense[id].peek();
      if (v > bestValue) {
        bestValue = v;
        best = id;
      }
    }
    signals.activeSense.value = best;
  };

  // React to every cell change — Theatre writes flow through here too, so the
  // dominant sense and the `sense:changed` mirror stay correct in both modes.
  for (const id of SENSE_ORDER) {
    unsubscribes.push(
      signals.sense[id].subscribe((value) => {
        recomputeDominant();
        bus.emit("sense:changed", { id, value });
      }),
    );
  }

  const manual = (fn: () => void): void => {
    signals.senseAuthority.value = "manual";
    fn();
  };

  unsubscribes.push(
    bus.on("sense:set", (payload) => {
      const cmd = readCommand(payload);
      if (!cmd || cmd.value === undefined) {
        return;
      }
      manual(() => {
        signals.sense[cmd.id].value = clamp01(cmd.value ?? 0);
      });
    }),
    bus.on("sense:toggle", (payload) => {
      const cmd = readCommand(payload);
      if (!cmd) {
        return;
      }
      manual(() => {
        signals.sense[cmd.id].value = signals.sense[cmd.id].peek() > 0 ? 0 : 1;
      });
    }),
    bus.on("sense:solo", (payload) => {
      const cmd = readCommand(payload);
      if (!cmd) {
        return;
      }
      manual(() => {
        for (const id of SENSE_ORDER) {
          signals.sense[id].value = id === cmd.id ? 1 : 0;
        }
      });
    }),
    bus.on("sense:clear", () => {
      manual(() => {
        for (const id of SENSE_ORDER) {
          signals.sense[id].value = 0;
        }
      });
    }),
  );

  return {
    dispose(): void {
      for (const off of unsubscribes) {
        off();
      }
      unsubscribes.length = 0;
    },
  };
}
