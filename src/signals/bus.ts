/**
 * Event bus — the "moments" half of the substrate (signals carry *state*; the bus carries
 * *events*). It is what lets any object **push** (`emit`) and **subscribe** (`on`) without the
 * two ends knowing about each other, and it generalises the clock's time-scheduler to fire on
 * **any signal crossing** (`when`), not just time. See docs/time-signals-theatre-plan.md §3.3.
 *
 * Payloads are `unknown` by design: the bus is an open channel (`cue:chirp`, `moth:caught`, a
 * `signal-lost` — coined by whoever emits), so a closed typed event-map would fight the modular
 * "objects coin their own events" goal. Handlers narrow the `unknown` at the edge, the same way
 * the ICAROS layer narrows socket frames.
 */
import type { Signal } from "./signal.ts";

export type EventHandler = (payload: unknown) => void;

export interface Bus {
  /** Subscribe to an event type. Returns an unsubscribe. */
  on(type: string, handler: EventHandler): () => void;
  /** Push an event. Handlers run synchronously in registration order. */
  emit(type: string, payload?: unknown): void;
  /**
   * Fire `handler` once on the **rising edge** of `predicate(signal)` (false→true). The
   * generalisation of `clock.schedule`: the predicate can test time, proximity, sense, control
   * quality — anything carried by a signal. Evaluated in {@link Bus.tick}. Returns an unsubscribe.
   */
  when<T>(sig: Signal<T>, predicate: (value: T) => boolean, handler: () => void): () => void;
  /** Evaluate all registered crossings once. Call once per frame, after producers have run. */
  tick(): void;
}

/** A registered crossing, type-erased behind its own `evaluate` closure so `T` stays local. */
interface Crossing {
  evaluate(): void;
}

export function createBus(): Bus {
  const handlers = new Map<string, Set<EventHandler>>();
  const crossings = new Set<Crossing>();

  return {
    on(type: string, handler: EventHandler): () => void {
      let set = handlers.get(type);
      if (!set) {
        set = new Set<EventHandler>();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(type);
        }
      };
    },

    emit(type: string, payload?: unknown): void {
      const set = handlers.get(type);
      if (!set) {
        return;
      }
      for (const handler of [...set]) {
        handler(payload);
      }
    },

    when<T>(sig: Signal<T>, predicate: (value: T) => boolean, handler: () => void): () => void {
      let was = predicate(sig.peek()); // arm at the current state so we only fire on a *new* crossing
      const crossing: Crossing = {
        evaluate(): void {
          const now = predicate(sig.peek());
          if (now && !was) {
            handler();
          }
          was = now;
        },
      };
      crossings.add(crossing);
      return () => {
        crossings.delete(crossing);
      };
    },

    tick(): void {
      for (const crossing of [...crossings]) {
        crossing.evaluate();
      }
    },
  };
}

/** The app-wide event bus singleton. */
export const bus: Bus = createBus();
