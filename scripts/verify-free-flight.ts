// Verification for the configure mode's free (creative) flight: boots straight into the
// configuration shell (?studio=1), then checks the three things that separate it from the glider —
// it does NOT drift when nothing is held, W moves along the view, Space climbs, and dragging the
// mouse turns the view.
//   bun run scripts/verify-free-flight.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/freeflight-verify";
await mkdir(OUT, { recursive: true });
const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.argv[2] ?? "https://localhost:5173/";

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

// ?studio=1 is the operator route ("Ablauf konfigurieren" reloads into it) — main.ts puts the
// interface into configure mode there, which is exactly where free flight should be armed.
await page.goto(`${BASE}?studio=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(11000); // renderer init + chunk streaming + flora GLBs
console.log("loaded");

// Confirm the configure shell is up (that is what arms the flight mode).
const shell = await page.evaluate(() => ({
  mode: document.body.dataset["experienceMode"] ?? "(none)",
  shellVisible: !document.querySelector<HTMLElement>(".bm-config-shell")?.hidden,
  panel: Boolean(document.querySelector(".fl-root")),
  activeMode:
    document.querySelector<HTMLElement>(".fl-row .fl-choice.active")?.textContent ?? "(none)",
}));
console.log("shell:", JSON.stringify(shell));

// Show the world: solo a colour sense, otherwise the void is white and motion is invisible.
const soloed = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent?.trim() === "Sinne & Welt") b.click();
  }
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

const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

// 1. Idle: the glider would have flown ~12 m in this gap. Free flight must not move at all.
await shot("01-idle-a");
await page.waitForTimeout(2500);
await shot("02-idle-b");
console.log("idle pair shot");

// 2. W: forward along the view.
await page.keyboard.down("w");
await page.waitForTimeout(1500);
await page.keyboard.up("w");
await shot("03-after-w");

// 3. Space: straight up (and it must NOT toggle the clock — that is the transport's key).
await page.keyboard.down("Space");
await page.waitForTimeout(1500);
await page.keyboard.up("Space");
await shot("04-after-space");

// 4. Drag look: hold a button over the canvas and sweep right.
await page.mouse.move(640, 400);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(640 - i * 22, 400);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(600);
await shot("05-after-look");
console.log("motion shots done");

// 5. The dev-panel override: back to the glider, which must start drifting forward by itself.
const switched = await page.evaluate(() => {
  const panel = document.querySelector(".fl-root");
  const button =
    panel && [...panel.querySelectorAll("button")].find((b) => b.textContent === "Gleiter");
  button?.click();
  return document.querySelector<HTMLElement>(".fl-row .fl-choice.active")?.textContent ?? "(none)";
});
console.log("switched to:", switched);
await shot("06-glider-a");
await page.waitForTimeout(2500);
await shot("07-glider-b");

// …and back to free flight, which must hold still again.
const back = await page.evaluate(() => {
  const panel = document.querySelector(".fl-root");
  const button =
    panel && [...panel.querySelectorAll("button")].find((b) => b.textContent === "Freiflug");
  button?.click();
  return document.querySelector<HTMLElement>(".fl-row .fl-choice.active")?.textContent ?? "(none)";
});
console.log("switched back to:", back);
await shot("08-free-a");
await page.waitForTimeout(2500);
await shot("09-free-b");

console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION|theatre/i;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line);
  }
}
await browser.close();
