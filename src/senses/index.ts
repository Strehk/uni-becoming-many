/**
 * "Senses" — input/perception layer. Stub that reports the pointer position
 * over a target element. Expand into the real perception system later.
 */
export interface Senses {
  readonly pointer: { x: number; y: number };
  dispose(): void;
}

export function createSenses(target: HTMLElement): Senses {
  const pointer = { x: 0, y: 0 };

  const onMove = (e: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    pointer.x = (e.clientX - rect.left) / rect.width;
    pointer.y = (e.clientY - rect.top) / rect.height;
  };

  target.addEventListener("pointermove", onMove);

  return {
    pointer,
    dispose() {
      target.removeEventListener("pointermove", onMove);
    },
  };
}
