// Fly the wordless lesson (EXPERIMENT) and check that it is really interactive: a task must
// NOT advance while the flier does nothing, must fill while they steer the asked-for way,
// and only the finished lesson may start the timeline.
//   bun run scripts/verify-onboarding.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/onboarding";
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
// The operator entries live in the settings now, not on the start screen.
await page.waitForSelector("text=Einstellungen", { timeout: 30000 });
await page.click("text=Einstellungen");
await page.waitForTimeout(600);
await page.click("text=Anleitung (Experiment)");
await page.waitForTimeout(600);
console.log(
  "Auswahl:",
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll(".bm-menu__list button")].map((b) => b.textContent?.trim()),
    ),
  ),
);

await page.click("text=Tutorial starten");
await page.waitForTimeout(4500); // the first sign gathers
const shot = async (name: string): Promise<void> => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
await shot("01-task1-idle");

// Doing nothing must leave the task where it is — that is what makes it a task.
await page.waitForTimeout(2500);
await shot("02-task1-still-idle");

/** Hold a key and shoot the fill as it grows. */
const flyFor = async (key: string, seconds: number, name: string): Promise<void> => {
  await page.keyboard.down(key);
  await page.waitForTimeout(seconds * 1000);
  await page.keyboard.up(key);
  await shot(name);
};

// Task 1 asks for a right turn: hold D and watch the arrow fill.
await page.keyboard.down("d");
await page.waitForTimeout(900);
await shot("03-task1-filling");
await page.waitForTimeout(2600);
await page.keyboard.up("d");
await shot("04-task1-done");
await page.waitForTimeout(2600); // success burst + next task gathers
await shot("05-task2");

// Task 2 asks for a left turn.
await flyFor("a", 3.6, "06-task2-done");
await page.waitForTimeout(2600);
await shot("07-task3-climb");

// Task 3 asks for a climb.
await flyFor("w", 3.5, "08-task3-done");
await page.waitForTimeout(2600);
await shot("09-task4-sink");

console.log("shots done");
console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION|m5/i;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line.slice(0, 220));
  }
}
await browser.close();
