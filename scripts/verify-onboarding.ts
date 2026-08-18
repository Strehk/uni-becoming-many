// Look at the wordless particle lesson (EXPERIMENT). Starts each concept from the menu and
// shoots the whole sequence densely, so the gathering and dissolving can be judged frame by
// frame — the only test that matters for something purely visual.
//   bun run scripts/verify-onboarding.ts [url] [concept]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/onboarding";
await mkdir(OUT, { recursive: true });
const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const URL = process.argv[2] ?? "https://localhost:5173/";
const CONCEPT = process.argv[3] ?? "Zeichen";

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
await page.waitForSelector("text=Anleitung (Experiment)", { timeout: 30000 });
await page.click("text=Anleitung (Experiment)");
await page.waitForTimeout(600);

const offered = await page.evaluate(() =>
  [...document.querySelectorAll(".bm-menu__list button")].map((b) => b.textContent?.trim()),
);
console.log("Auswahl:", JSON.stringify(offered));

await page.click(`text=${CONCEPT} starten`);
await page.waitForTimeout(2500);
await page.keyboard.press("Enter"); // the start gate
console.log("gestartet:", CONCEPT);

// The lesson runs ~25 s; a frame every 0.7 s catches every gather and release.
for (let i = 0; i < 34; i++) {
  await page.waitForTimeout(700);
  await page.screenshot({
    path: `${OUT}/${CONCEPT.toLowerCase()}-${String(i).padStart(2, "0")}.png`,
  });
}
console.log("shots done");

console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION|m5/i;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line.slice(0, 220));
  }
}
await browser.close();
