// One-off verification driver for the scripted bird event: boots the app in
// headless Chromium (WebGPU), starts the experience, opens the C dev console,
// clicks the "Vogel-Rundflug" trigger and captures the flight over time to
// /tmp/bird-event-verify/.
//   bun run scripts/verify-bird-event.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/bird-event-verify";
await mkdir(OUT, { recursive: true });

const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const URL = process.argv[2] ?? "https://localhost:5173/";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--hide-scrollbars"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  ignoreHTTPSErrors: true,
});

const logs: string[] = [];
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });

const hasGpu = await page.evaluate(async () => {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!nav.gpu) return "no navigator.gpu";
  const adapter = await nav.gpu.requestAdapter();
  return adapter ? "adapter ok" : "no adapter";
});
console.log("webgpu:", hasGpu);

// Playback mode hides the dev console — enter configure mode instead (the
// editor shell opens with the console visible and the clock running).
await page.waitForSelector("text=Experience konfigurieren", { timeout: 30000 });
await page.click("text=Experience konfigurieren");
console.log("configure mode");
await page.waitForTimeout(6000); // renderer init + first chunks + assets

const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
};

const trigger = page.locator("button.ev-trigger", { hasText: "Vogel-Rundflug" });
await trigger.waitFor({ timeout: 5000 });
console.log("events panel found");
await shot("00-console-open");
// The drawer scrolls — a DOM click sidesteps Playwright's viewport check.
const clickTrigger = (): Promise<void> => trigger.evaluate((b) => (b as HTMLButtonElement).click());

// ── Flight 1: in the white void (the event bird must be visible WITHOUT a sense) ──
// Fly-by profile (3 s route + 4.8 s exit): approach from ~10 m, closest pass
// ~2 m at t≈1.5 s, then 2–4.5 m beside the flight line, exit until ~7.5 s.
await clickTrigger();
await page.keyboard.press("c"); // close the console for a clean view
console.log("triggered (void)");
await page.waitForTimeout(700);
await shot("01-void-t0.7");
await page.waitForTimeout(700);
await shot("02-void-t1.4");
await page.waitForTimeout(800);
await shot("03-void-t2.2");
await page.waitForTimeout(1300);
await shot("04-void-t3.5-exit");
await page.waitForTimeout(5500);
await shot("05-void-t9-gone");

// ── Flight 2: with farben active (bird over the coloured world) ──
await page.keyboard.press("Digit6");
await page.waitForTimeout(4000);
await page.keyboard.press("c");
await page.waitForTimeout(300);
await clickTrigger();
await page.keyboard.press("c");
console.log("triggered (farben)");
await page.waitForTimeout(800);
await shot("06-farben-t0.8");
await page.waitForTimeout(800);
await shot("07-farben-t1.6");
await page.waitForTimeout(900);
await shot("08-farben-t2.5");
await page.waitForTimeout(1500);
await shot("09-farben-t4-exit");

console.log("\n── console log tail ──");
for (const line of logs.slice(-60)) console.log(line);

await browser.close();
