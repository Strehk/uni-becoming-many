// Drives the real gyro module (src/player/gyro-controls.ts, served by vite) with
// synthetic DeviceOrientation readings and checks the steering it reports:
// neutral-on-first-reading, dead zone, tilt-right→turn-right, pull-back→climb,
// and the screen-rotation compensation used in landscape.
//   bun run scripts/verify-gyro.ts [url]
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const URL = process.argv[2] ?? "https://localhost:5173/";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const page = await browser.newPage({
  viewport: { width: 900, height: 600 },
  ignoreHTTPSErrors: true,
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const results = await page.evaluate(async () => {
  const mod = await import("/src/player/gyro-controls.ts");
  const out: Record<string, unknown> = {};

  const tilt = (beta: number, gamma: number): void => {
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { beta, gamma, alpha: 0 }),
    );
  };
  /** Settle the spring: many small steps, as a real frame loop would. */
  const settle = (g: { update(dt: number): void }): void => {
    for (let i = 0; i < 120; i++) g.update(1 / 60);
  };

  // ── portrait ──
  const g = mod.createGyroControls({ rangeDegrees: 30 });
  out["enabled"] = await g.enable();

  tilt(60, 0); // a normal holding angle becomes neutral
  settle(g);
  out["neutral"] = { roll: +g.steering.roll.toFixed(3), pitch: +g.steering.pitch.toFixed(3) };

  tilt(61, 1); // inside the dead zone
  settle(g);
  out["deadZone"] = { roll: +g.steering.roll.toFixed(3), pitch: +g.steering.pitch.toFixed(3) };

  tilt(60, 20); // right edge dips → turn right (roll > 0)
  settle(g);
  out["tiltRight"] = +g.steering.roll.toFixed(3);

  tilt(60, -20);
  settle(g);
  out["tiltLeft"] = +g.steering.roll.toFixed(3);

  tilt(85, 0); // pull back → climb (pitch > 0)
  settle(g);
  out["pullBack"] = +g.steering.pitch.toFixed(3);

  tilt(35, 0); // push forward → descend
  settle(g);
  out["pushForward"] = +g.steering.pitch.toFixed(3);

  tilt(60, 90); // far beyond the range → clamped to exactly 1
  settle(g);
  out["clamped"] = +g.steering.roll.toFixed(3);

  // Re-calibrating at the current pose must read as "straight ahead" again.
  g.calibrate();
  tilt(60, 90);
  settle(g);
  out["afterCalibrate"] = +g.steering.roll.toFixed(3);
  g.dispose();

  // ── landscape: the same physical tilt must steer the same way ──
  // screen.orientation.angle is read-only, so stub the whole object for the test.
  const real = Object.getOwnPropertyDescriptor(window.screen, "orientation");
  Object.defineProperty(window.screen, "orientation", {
    configurable: true,
    get: () => ({ angle: 90, type: "landscape-primary" }),
  });

  const land = mod.createGyroControls({ rangeDegrees: 30 });
  await land.enable();
  tilt(0, -60); // holding a phone upright in landscape
  settle(land);
  out["landscapeNeutral"] = +land.steering.roll.toFixed(3);
  // In landscape the *visible* right edge dips when beta grows (see readTilt).
  tilt(20, -60);
  settle(land);
  out["landscapeTiltRight"] = +land.steering.roll.toFixed(3);
  // Pulling the visible top toward you rides on gamma in landscape, and in the
  // *falling* direction: positive gamma tips the screen normal toward the visible
  // top, i.e. pushes that edge away from you.
  tilt(0, -80);
  settle(land);
  out["landscapePullBack"] = +land.steering.pitch.toFixed(3);
  tilt(0, -40);
  settle(land);
  out["landscapePushForward"] = +land.steering.pitch.toFixed(3);
  land.dispose();

  if (real) Object.defineProperty(window.screen, "orientation", real);
  return out;
});

console.log(JSON.stringify(results, null, 2));

const ok =
  results["enabled"] === true &&
  (results["tiltRight"] as number) > 0.5 &&
  (results["tiltLeft"] as number) < -0.5 &&
  (results["pullBack"] as number) > 0.5 &&
  (results["pushForward"] as number) < -0.5 &&
  (results["clamped"] as number) === 1 &&
  (results["afterCalibrate"] as number) === 0 &&
  (results["landscapeTiltRight"] as number) > 0.5 &&
  (results["landscapePullBack"] as number) > 0.5 &&
  (results["landscapePushForward"] as number) < -0.5;

console.log(ok ? "\nGYRO OK" : "\nGYRO FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
