// One-off verification driver: loads the app in headless Chromium (WebGPU),
// starts the experience, toggles senses, flies, and captures screenshots +
// console output to /tmp/nature-verify/.
//   bun run scripts/verify-nature.ts
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/nature-verify";
await mkdir(OUT, { recursive: true });

const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const URL = process.argv[2] ?? "https://localhost:5175/";

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

// WebGPU sanity.
const hasGpu = await page.evaluate(async () => {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!nav.gpu) return "no navigator.gpu";
  const adapter = await nav.gpu.requestAdapter();
  return adapter ? "adapter ok" : "no adapter";
});
console.log("webgpu:", hasGpu);

// Start the experience.
await page.waitForSelector("text=Experience starten", { timeout: 30000 });
await page.click("text=Experience starten");
console.log("started");
await page.waitForTimeout(6000); // renderer init + first chunks + flora GLBs

const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
};

// Farben (Digit6): the world in colour.
await page.keyboard.press("Digit6");
await page.waitForTimeout(4000);
await shot("01-farben-spawn");

// Fly forward a while to cross terrain, capture the forest from the air.
await page.keyboard.down("w");
await page.waitForTimeout(9000);
await page.keyboard.up("w");
await page.waitForTimeout(1500);
await shot("02-farben-flight");

await page.keyboard.down("s");
await page.waitForTimeout(2500);
await page.keyboard.up("s");
await page.waitForTimeout(9000);
await shot("03-farben-flight2");

// Infrarot (Digit4): dead wood cold, mushrooms/stone warm.
await page.keyboard.press("Digit6"); // farben off
await page.keyboard.press("Digit4");
await page.waitForTimeout(4000);
await shot("04-infrarot");

// UV (Digit5).
await page.keyboard.press("Digit4");
await page.keyboard.press("Digit5");
await page.waitForTimeout(4000);
await shot("05-uv");

// Duft (Digit7) — scent plumes from real flora.
await page.keyboard.press("Digit4");
await page.keyboard.press("Digit7");
await page.waitForTimeout(6000);
await shot("06-duft");

// Echo (Digit2) sanity.
await page.keyboard.press("Digit7");
await page.keyboard.press("Digit2");
await page.waitForTimeout(3000);
await shot("07-echo");

console.log("\n── console log tail ──");
for (const line of logs.slice(-60)) console.log(line);

await browser.close();
