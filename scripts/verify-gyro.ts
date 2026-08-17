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
    for (let i = 0; i < 200; i++) g.update(1 / 60);
  };
  const read = (g: { steering: { pitch: number; roll: number } }, key: "pitch" | "roll"): number =>
    +g.steering[key].toFixed(3);

  // ── portrait (screen.orientation.angle = 0) ──
  // Neutral is a reclined reading pose, not flat and not bolt upright.
  const g = mod.createGyroControls({ rangeDegrees: 30 });
  out["enabled"] = await g.enable();

  tilt(30, 0);
  settle(g);
  out["neutral"] = { roll: read(g, "roll"), pitch: read(g, "pitch") };

  tilt(31, 1); // inside the dead zone
  settle(g);
  out["deadZone"] = { roll: read(g, "roll"), pitch: read(g, "pitch") };

  tilt(30, 45); // right edge dips → turn right
  settle(g);
  out["tiltRight"] = read(g, "roll");

  tilt(30, -45);
  settle(g);
  out["tiltLeft"] = read(g, "roll");

  tilt(90, 0); // top edge rotated toward you → climb
  settle(g);
  out["pullBack"] = read(g, "pitch");

  tilt(5, 0); // laid flat, screen up → dive
  settle(g);
  out["pushForward"] = read(g, "pitch");

  g.calibrate(); // re-neutralise at this pose
  tilt(5, 0);
  settle(g);
  out["afterCalibrate"] = read(g, "pitch");

  // Same tilt, gentler setting → smaller deflection.
  g.calibrate();
  tilt(30, 0);
  settle(g);
  tilt(30, 25);
  settle(g);
  const sharp = read(g, "roll");
  g.setRange(50);
  settle(g);
  out["gentlerIsSmaller"] = read(g, "roll") < sharp && read(g, "roll") > 0;
  g.dispose();

  // ── landscape (angle = 90: the device turned clockwise, top edge to the right) ──
  const real = Object.getOwnPropertyDescriptor(window.screen, "orientation");
  Object.defineProperty(window.screen, "orientation", {
    configurable: true,
    get: () => ({ angle: 90, type: "landscape-primary" }),
  });

  const land = mod.createGyroControls({ rangeDegrees: 30 });
  await land.enable();
  tilt(0, 70); // held in landscape, reclined ~20° — the neutral pose
  settle(land);
  out["landscapeNeutral"] = { roll: read(land, "roll"), pitch: read(land, "pitch") };

  tilt(-30, 70); // roll the visible right edge down → turn right
  settle(land);
  out["landscapeTiltRight"] = read(land, "roll");

  tilt(30, 70);
  settle(land);
  out["landscapeTiltLeft"] = read(land, "roll");

  // Rotating the visible top toward you passes gamma's ±90 fold, where beta jumps by
  // 180. The gravity basis must carry straight through it — that fold is what made
  // the raw-Euler version erratic.
  tilt(0, 88);
  settle(land);
  out["landscapeClimbNear"] = read(land, "pitch");
  tilt(180, 70); // the same motion continued, past the fold
  settle(land);
  out["landscapeClimbPastFold"] = read(land, "pitch");

  tilt(0, 20); // laid back toward flat → dive
  settle(land);
  out["landscapeDive"] = read(land, "pitch");

  // Vertical must be calmer than horizontal for the same tilt off neutral.
  land.calibrate();
  tilt(0, 70);
  settle(land);
  tilt(-25, 70); // 25° of bank
  settle(land);
  const bank = Math.abs(read(land, "roll"));
  tilt(0, 45); // 25° of pitch
  settle(land);
  const climb = Math.abs(read(land, "pitch"));
  out["pitchCalmerThanRoll"] = { bank, climb, ok: climb < bank };
  land.dispose();

  if (real) Object.defineProperty(window.screen, "orientation", real);
  return out;
});

console.log(JSON.stringify(results, null, 2));

const n = (key: string): number => results[key] as number;
const pair = (key: string): { roll: number; pitch: number } =>
  results[key] as { roll: number; pitch: number };

const checks: Array<[string, boolean]> = [
  ["enabled", results["enabled"] === true],
  ["neutral is zero", pair("neutral").roll === 0 && pair("neutral").pitch === 0],
  ["dead zone holds", pair("deadZone").roll === 0 && pair("deadZone").pitch === 0],
  ["tilt right turns right", n("tiltRight") > 0.5],
  ["tilt left turns left", n("tiltLeft") < -0.5],
  ["pull back climbs", n("pullBack") > 0.5],
  ["flat dives", n("pushForward") < -0.1],
  ["calibrate re-zeroes", n("afterCalibrate") === 0],
  ["gentler setting deflects less", results["gentlerIsSmaller"] === true],
  [
    "landscape neutral is zero",
    pair("landscapeNeutral").roll === 0 && pair("landscapeNeutral").pitch === 0,
  ],
  ["landscape tilt right turns right", n("landscapeTiltRight") > 0.5],
  ["landscape tilt left turns left", n("landscapeTiltLeft") < -0.5],
  ["landscape climbs", n("landscapeClimbNear") > 0],
  ["landscape climbs past the gamma fold", n("landscapeClimbPastFold") > 0.4],
  ["landscape dives", n("landscapeDive") < -0.5],
  ["vertical is calmer than horizontal", (results["pitchCalmerThanRoll"] as { ok: boolean }).ok],
];

for (const [name, passed] of checks) {
  console.log(`${passed ? "  ok" : "FAIL"}  ${name}`);
}
const ok = checks.every(([, passed]) => passed);

console.log(ok ? "\nGYRO OK" : "\nGYRO FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
