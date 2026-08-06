// One-off verification driver for the redesigned start menu + mobile mode.
// Captures the start screen, the Einstellungen screen (desktop + phone viewport),
// and checks that the world is not drawn while the menu is up.
//   bun run scripts/verify-menu.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/menu-verify";
await mkdir(OUT, { recursive: true });

const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const URL = process.argv[2] ?? "https://localhost:5173/";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--hide-scrollbars"],
});

const logs: string[] = [];

async function shoot(
  name: string,
  width: number,
  height: number,
  drive: (p: Page) => Promise<void>,
) {
  const page = await browser.newPage({ viewport: { width, height }, ignoreHTTPSErrors: true });
  page.on("console", (m) => logs.push(`[${name}][${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[${name}][pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await drive(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
}

type Page = Awaited<ReturnType<typeof browser.newPage>>;

// 1. The start screen, desktop.
await shoot("01-home", 1280, 800, async (page) => {
  const items = await page.$$eval(".bm-menu__item", (els) => els.map((e) => e.textContent));
  console.log("menu items:", JSON.stringify(items));
  const font = await page.$eval(".bm-menu__title", (el) => getComputedStyle(el).fontFamily);
  console.log("title font:", font);
  const loaded = await page.evaluate(() => document.fonts.check('16px "Heavitas"'));
  console.log("heavitas loaded:", loaded);
});

// 2. The Einstellungen screen.
await shoot("02-settings", 1280, 800, async (page) => {
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__item"));
    items.find((i) => i.textContent?.includes("Einstellungen"))?.click();
  });
  await page.waitForTimeout(400);
  const sections = await page.$$eval(".bm-menu__section-title", (e) => e.map((x) => x.textContent));
  const choices = await page.$$eval(".bm-menu__choice-label", (e) => e.map((x) => x.textContent));
  console.log("sections:", JSON.stringify(sections));
  console.log("choices:", JSON.stringify(choices));
});

// 3. Quality preset click — does it reach the world?
await shoot("03-quality", 1280, 800, async (page) => {
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__item"));
    items.find((i) => i.textContent?.includes("Einstellungen"))?.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__choice"));
    c.find((x) => x.textContent?.includes("Niedrig"))?.click();
  });
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => localStorage.getItem("becoming-many:settings:v1"));
  console.log("stored settings:", stored);
  const pressed = await page.$$eval(".bm-menu__choice[aria-pressed='true']", (e) =>
    e.map((x) => x.textContent),
  );
  console.log("active choices:", JSON.stringify(pressed));
});

// 4. Steering section with the gyro rows revealed.
await shoot("04-control", 1280, 800, async (page) => {
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__item"));
    items.find((i) => i.textContent?.includes("Einstellungen"))?.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__choice"));
    c.find((x) => x.textContent?.includes("Handy neigen"))?.click();
  });
  await page.waitForTimeout(400);
  const rowsVisible = await page.$eval(".bm-menu__rows", (el) => !el.hidden);
  console.log("gyro rows visible:", rowsVisible);
});

// 5. Phone viewport — the start screen as a visitor sees it.
await shoot("05-phone", 390, 844, async (page) => {
  const items = await page.$$eval(".bm-menu__item", (els) => els.map((e) => e.textContent));
  console.log("phone menu order:", JSON.stringify(items));
});

// 6. Is the world actually not drawn while the menu is up?
{
  const page = await browser.newPage({
    viewport: { width: 900, height: 600 },
    ignoreHTTPSErrors: true,
  });
  page.on("console", (m) => logs.push(`[paused][${m.type()}] ${m.text()}`));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  // The canvas keeps its last drawn content; count how many frames actually render
  // by watching three's render call count via the inspector-free path: compare two
  // canvas snapshots a second apart while the menu is up.
  const sample = async (): Promise<string> =>
    page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas instanceof HTMLCanvasElement ? canvas.toDataURL().slice(0, 2000) : "no-canvas";
    });
  const a = await sample();
  await page.waitForTimeout(1200);
  const b = await sample();
  console.log("canvas frozen while menu up:", a === b, `(len ${a.length})`);

  // Now start and confirm it moves again.
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".bm-menu__item"));
    items.find((i) => i.textContent?.includes("Experience starten"))?.click();
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  const c = await sample();
  await page.waitForTimeout(900);
  const d = await sample();
  console.log("canvas live after start:", c !== d);
  await page.screenshot({ path: `${OUT}/06-after-start.png` });
  await page.close();
}

await browser.close();
console.log("\n--- console (filtered) ---");
for (const line of logs) {
  if (/icaros|audio\] failed|WFC|Tone|AudioContext|suspended/i.test(line)) continue;
  console.log(line);
}
console.log(`\nscreenshots in ${OUT}`);
