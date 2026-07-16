// One-off verification driver for the magnetfeld sense's field-line dome:
// starts the experience, solos "Magnetfeld", isolates the Feldlinien-Dom mode,
// and looks up at the sky to check the dipole field-line curvature.
//   bun run scripts/verify-magnetfeld.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/magnet-verify";
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
await page.waitForSelector("text=Experience starten", { timeout: 30000 });
await page.click("text=Experience starten");
await page.waitForTimeout(2000);
await page.keyboard.press("Enter");
console.log("started");
await page.waitForTimeout(6000);

// Solo Magnetfeld, then isolate the Feldlinien-Dom mode: weight.lines = 1, the
// other eight mode weights = 0, so only the field lines show.
const setup = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.textContent?.trim() === "Manuell")?.click();
  const card = [...document.querySelectorAll("details.sc-card")].find((c) =>
    c.textContent?.includes("Magnetfeld"),
  );
  if (!card) return "no magnetfeld card";
  (card as HTMLDetailsElement).open = true;
  const solo = [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Solo"));
  solo?.click();

  let touched = 0;
  for (const row of card.querySelectorAll(".sc-row")) {
    const label = row.querySelector(".sc-label")?.textContent ?? "";
    const slider = row.querySelector<HTMLInputElement>("input[type=range]");
    if (!slider || !label.startsWith("Mix · ")) continue;
    slider.value = label.includes("Feldlinien") ? "1" : "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    touched++;
  }
  return `solo+mix set (${touched} mix sliders)`;
});
console.log("setup:", setup);

// Fade-in is 3 s. Pitch up to look at the sky where the dome lives.
await page.waitForTimeout(3500);
await page.keyboard.down("w");
await page.waitForTimeout(1400);
await page.keyboard.up("w");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-lines-up.png` });
console.log("shot 01");

await page.keyboard.down("w");
await page.waitForTimeout(1200);
await page.keyboard.up("w");
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-lines-higher.png` });
console.log("shot 02");

console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION/;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line);
  }
}
await browser.close();
