// Verification for the global animal-pace slider ("Fauna · Tempo (alle Tiere)"). Mosquito swarms
// are the clearest subject: a dense, close cloud whose motion is unmistakable between two frames.
// The configure mode's free flight keeps the camera perfectly still, so anything that moves in the
// picture is the animals themselves.
//   bun run scripts/verify-animal-speed.ts [url]
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const OUT = "/tmp/animal-speed";
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

await page.goto(`${BASE}?studio=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(11000);

// Every speed knob present, and which group it sits in?
const sliders = await page.evaluate(() => {
  const out: Record<string, string> = {};
  for (const group of document.querySelectorAll("details")) {
    const title = group.querySelector("summary")?.textContent?.trim() ?? "?";
    for (const row of group.querySelectorAll("div")) {
      const label = row.textContent?.trim() ?? "";
      const range = row.querySelector<HTMLInputElement>('input[type="range"]');
      if (!range) continue;
      if (/^(Tempo ×|Schritt-Tempo ×|Tempo \(m\/s\))/.test(label)) {
        out[`${title} · ${label.split("\n")[0]?.slice(0, 22)}`] = range.value;
      }
    }
  }
  return out;
});
console.log("Tempo-Regler:", JSON.stringify(sliders, null, 1));

// Open the console, hand the senses to manual control and reveal the mosquitoes: they only show
// with echo AND duft up (main.ts gates them on both).
await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent?.trim() === "Sinne & Welt") b.click();
  }
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent?.trim() === "Manuell") b.click();
  }
  for (const name of ["Echoortung", "Chemische Wahrnehmung", "Farben"]) {
    const card = [...document.querySelectorAll("details.sc-card")].find((c) =>
      c.textContent?.includes(name),
    );
    const on =
      card && [...card.querySelectorAll("button")].find((b) => b.textContent === "An / Aus");
    on?.click();
  }
});
await page.waitForTimeout(4500); // sense fades

/** Fire the mosquito event and let the swarm settle in front of the camera. */
const fired = await page.evaluate(() => {
  const button = [...document.querySelectorAll(".ev-trigger")].find((b) =>
    /m[üu]ck|mosquito/i.test(b.textContent ?? ""),
  );
  (button as HTMLButtonElement | undefined)?.click();
  return button?.textContent ?? "(no mosquito trigger)";
});
console.log("event:", fired);
await page.waitForTimeout(3000);

const setSpeed = async (value: number): Promise<void> => {
  await page.evaluate((v) => {
    const rows = [...document.querySelectorAll("div")];
    const row = rows.find((r) => r.textContent?.trim().startsWith("Tempo ×"));
    const range = row?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!range) return;
    range.value = String(v);
    range.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(700); // the controller debounces at 160 ms
};

// Pace 1: the swarm must visibly churn between the two frames.
await setSpeed(1);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/01-pace1-a.png` });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-pace1-b.png` });

// Pace 0: everything must stand perfectly still.
await setSpeed(0);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/03-pace0-a.png` });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/04-pace0-b.png` });

console.log("shots done");
console.log("\n── errors ──");
const noise = /icaros|audio|AudioContext|Tone\.js|404|WFC|websocket|ERR_CONNECTION|theatre/i;
for (const line of logs) {
  if ((line.startsWith("[error]") || line.startsWith("[pageerror]")) && !noise.test(line)) {
    console.log(line.slice(0, 200));
  }
}
await browser.close();
