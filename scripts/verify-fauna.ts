// One-off verification for the new flora (flowers/bush) + fauna (butterfly/meise):
// starts the experience under the farben sense, boosts flower/butterfly/meise
// counts, and skims low over the ground to catch them.
//   bun run scripts/verify-fauna.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/fauna-verify";
await mkdir(OUT, { recursive: true });
const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
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
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Experience starten", { timeout: 30000 });
await page.click("text=Experience starten");
await page.waitForTimeout(2000);
await page.keyboard.press("Enter");
console.log("started");
await page.waitForTimeout(6000);

// Solo the farben sense so the world shows in colour (flowers + fauna visible).
const soloed = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent?.trim() === "Manuell") b.click();
  }
  const card = [...document.querySelectorAll("details.sc-card")].find((c) =>
    c.textContent?.includes("Farben"),
  );
  const solo =
    card && [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Solo"));
  solo?.click();
  return solo ? "ok" : "no farben solo";
});
console.log("solo farben:", soloed);
await page.waitForTimeout(4000);

// Cross the spawn lake to reach land, then level out and skim the meadow low.
await page.keyboard.press("s"); // small nose-down nudge to keep moving forward-level
await page.waitForTimeout(11000); // auto-forward glider crosses to land
await page.screenshot({ path: `${OUT}/01-approach.png` });
console.log("shot 01");

// Dive to ground level over land and hold, sweeping frames — butterflies/meise
// flit low near the flowers here.
await page.keyboard.down("s");
await page.waitForTimeout(1400);
await page.keyboard.up("s");
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/02-low-${i}.png` });
}
console.log("shot 02 sweep");

console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION/;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line);
  }
}
await browser.close();
