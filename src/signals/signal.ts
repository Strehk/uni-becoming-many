/**
 * Signal<T> — the reactive cell at the heart of the substrate.
 *
 * A deliberately tiny reactive value: a current value you can read (`.value` / `peek`),
 * write (`.value =`), and observe (`subscribe`). There is **no auto-tracking** — reading a
 * signal never implicitly registers a dependency. That is a design choice, not an omission
 * (see docs/time-signals-theatre-plan.md §1, "Perf Law"): auto-tracking reactivity is built
 * for event-rate UI updates, not for a 90 fps VR loop fanning out over 80k particles.
 *
 * Two access patterns, by intent:
 *   - `subscribe(fn)` — for **coarse / event-rate** state (sense switches, region entry,
 *     authored-envelope changes). Fires only when the value actually changes.
 *   - `peek()`        — the **hot-path** accessor: a plain field read, no subscription, no
 *     tracking. Use this every frame for continuous state (player pose, authored scalars).
 *
 * `.value` (the getter) is identical to `peek()`; both exist so call sites read as intent —
 * `peek()` shouts "hot path, no subscription" at the reader.
 *
 * Equality: writes are ignored when the new value is equal to the old one (default `Object.is`).
 * Pass a custom `equals` for structural cells. Note the corollary for **mutated-in-place**
 * values (e.g. a pose object reused every frame): `Object.is(old, new)` is always true for the
 * same reference, so subscribers never fire — such cells are `peek`-only by construction, which
 * is exactly what we want for hot-path state.
 */
export interface Signal<T> {
  /** Current value. Reading is tracking-free; assigning notifies subscribers iff it changed. */
  value: T;
  /** Read without subscribing — the documented hot-path accessor. */
  peek(): T;
  /** Observe changes. Returns an unsubscribe. Fires on change only, never on identical writes. */
  subscribe(fn: (value: T) => void): () => void;
}

/**
 * Create a {@link Signal}. `equals` decides whether a write is a no-op (default `Object.is`).
 */
export function signal<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Signal<T> {
  let current = initial;
  const subscribers = new Set<(value: T) => void>();

  return {
    get value(): T {
      return current;
    },
    set value(next: T) {
      if (equals(current, next)) {
        return;
      }
      current = next;
      // Snapshot into an array so a subscriber that unsubscribes (or subscribes) during
      // dispatch can't perturb the in-progress iteration.
      for (const fn of [...subscribers]) {
        fn(current);
      }
    },
    peek(): T {
      return current;
    },
    subscribe(fn: (value: T) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
