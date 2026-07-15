// One-off verification driver for the netzwerk sense's WFC root web:
// starts the experience, solos "Netzwerk" via the dev-console Sinne panel,
// dives toward the ground and captures screenshots + console output.
//   bun run scripts/verify-netzwerk.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/netzwerk-verify";
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
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });

// Start the experience: menu button → Enter gate → renderer init.
await page.waitForSelector("text=Experience starten", { timeout: 30000 });
await page.click("text=Experience starten");
await page.waitForTimeout(2000);
await page.keyboard.press("Enter");
console.log("started");
await page.waitForTimeout(6000);

// Solo the Netzwerk sense via the Sinne panel DOM (drawer may stay closed).
const soloed = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  const manuell = buttons.find((b) => b.textContent?.trim() === "Manuell");
  manuell?.click();
  const cards = [...document.querySelectorAll("details.sc-card")];
  const card = cards.find((c) => c.textContent?.includes("Netzwerk"));
  if (!card) return "no netzwerk card";
  const solo = [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Solo"));
  if (!solo) return "no solo button";
  solo.click();
  return "ok";
});
console.log("solo netzwerk:", soloed);

// Fade-in is 2.5 s; the root web rebuild happens on the first visible frame.
await page.waitForTimeout(5000);
console.log("rebuild log:", logs.filter((l) => l.includes("[netzwerk]")).join(" | ") || "NONE");

// Pump the root alphas so the strands pop for the screenshots.
const pumped = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".sc-row")];
  let hit = 0;
  for (const row of rows) {
    const label = row.querySelector(".sc-label")?.textContent ?? "";
    const slider = row.querySelector<HTMLInputElement>("input[type=range]");
    if (!slider) continue;
    if (label === "Wurzeln · Grund-Alpha" || label === "Wurzeln · Hotspot-Alpha") {
      slider.value = "1";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      hit++;
    } else if (label === "Wurzeln · Sichtweite") {
      slider.value = "250";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      hit++;
    }
  }
  return hit;
});
console.log("alpha sliders pumped:", pumped);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/01-netzwerk-air.png` });
console.log("shot 01");

// Dive toward the ground so the root strands fill the frame.
await page.keyboard.down("s");
await page.waitForTimeout(1600);
await page.keyboard.up("s");
await page.screenshot({ path: `${OUT}/02-netzwerk-dive.png` });
console.log("shot 02");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-netzwerk-low.png` });
console.log("shot 03");

// Fly on across several world blocks — rebuilds must only add rim blocks.
await page.keyboard.down("w");
await page.waitForTimeout(16000);
await page.keyboard.up("w");
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/04-netzwerk-flight.png` });
console.log("shot 04");

// Dive over land — looking down, the web must show through the ground skin.
await page.keyboard.down("s");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/05-netzwerk-lookdown.png` });
await page.keyboard.up("s");
console.log("shot 05");
console.log(
  "rebuilds:",
  logs
    .filter((l) => l.includes("[netzwerk]"))
    .slice(-6)
    .join("\n  "),
);

console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC/;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line);
  }
}

await browser.close();
