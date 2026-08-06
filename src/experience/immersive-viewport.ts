// ── Becoming Many — Immersive viewport (mobile mode) ─────────────
//
// Two browser-chrome concerns the phone flight needs, and neither is essential:
// fullscreen (so the address bar stops eating the sky, and so the tilt is read
// against a stable viewport) and a landscape lock (the world is a horizon; a
// portrait letterbox wastes it).
//
// Both are best-effort by design. Every path here can legitimately fail — iOS
// Safari has no Fullscreen API on iPhone, orientation locking needs fullscreen
// first and is refused outright by some browsers — and none of it is worth
// interrupting the piece for. A refusal is swallowed; the flight begins either way.
//
// Must be called from inside a user gesture, like the permission prompt it follows.

export async function enterImmersiveViewport(): Promise<void> {
  await requestFullscreen();
  await lockLandscape();
}

async function requestFullscreen(): Promise<void> {
  const element = document.documentElement;
  if (document.fullscreenElement || typeof element.requestFullscreen !== "function") {
    return;
  }
  try {
    await element.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // No Fullscreen API (iPhone Safari) or the gesture was not accepted — fine.
  }
}

async function lockLandscape(): Promise<void> {
  const lock = orientationLock();
  if (!lock) {
    return;
  }
  try {
    await lock("landscape");
  } catch {
    // Desktop browsers and iOS refuse the lock; the CSS layout handles portrait.
  }
}

/** `screen.orientation.lock` where it exists. Typed guard — no cast. */
function orientationLock(): ((orientation: string) => Promise<void>) | null {
  const orientation: unknown = screen.orientation;
  if (typeof orientation !== "object" || orientation === null || !("lock" in orientation)) {
    return null;
  }
  const lock: unknown = orientation.lock;
  if (typeof lock !== "function") {
    return null;
  }
  return async (value: string): Promise<void> => {
    await lock.call(orientation, value);
  };
}
