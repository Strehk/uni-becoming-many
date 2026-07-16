// Performance profiler: boots the app, then isolates the cost of each sense and
// each heavy world system by toggling it and sampling GPU time + draw calls +
// triangles + frame time. Prints a breakdown of where the frame budget goes.
//   bun run scripts/profile-perf.ts [url]
import { homedir } from "node:os";
import { chromium } from "playwright-core";

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
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Experience starten", { timeout: 30000 });
await page.click("text=Experience starten");
await page.waitForTimeout(2000);
await page.keyboard.press("Enter");
console.log("started, streaming…");
await page.waitForTimeout(9000); // let terrain/flora/fauna stream in and settle

// Flip sense authority to manual so we can solo senses from the panel deterministically.
await page.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if (b.textContent?.trim() === "Manuell") b.click();
  }
});

// --- one measurement: sample GPU ms + renderer.info over `ms`, averaged. ---
async function measure(ms: number): Promise<{
  gpuMs: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}> {
  return await page.evaluate(async (durationMs: number) => {
    const dbg = (window as unknown as { __bmDebug?: { renderer?: unknown } }).__bmDebug;
    const renderer = dbg?.renderer as
      | (import("three/webgpu").WebGPURenderer & {
          info: {
            render: { drawCalls?: number; calls?: number; triangles: number };
            memory: { geometries: number; textures: number };
          };
        })
      | undefined;
    if (!renderer)
      return { gpuMs: -1, frameMs: -1, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
    const gpu: number[] = [];
    const frame: number[] = [];
    let last = performance.now();
    const end = last + durationMs;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = performance.now();
      frame.push(now - last);
      last = now;
      try {
        const t = await (
          renderer as unknown as { resolveTimestampsAsync(): Promise<number> }
        ).resolveTimestampsAsync();
        if (typeof t === "number" && t > 0) gpu.push(t);
      } catch {}
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const info = renderer.info;
    return {
      gpuMs: +avg(gpu).toFixed(3),
      frameMs: +avg(frame).toFixed(2),
      drawCalls: info.render.drawCalls ?? info.render.calls ?? 0,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }, ms);
}

// Solo a sense by clicking its card's Solo button (Solo is exclusive — others → 0).
async function solo(senseLabel: string): Promise<void> {
  await page.evaluate((label: string) => {
    const card = [...document.querySelectorAll("details.sc-card")].find((c) =>
      c.textContent?.includes(label),
    );
    const soloBtn =
      card && [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Solo"));
    soloBtn?.click();
  }, senseLabel);
  await page.waitForTimeout(2600); // sense fade-in
}

const rows: Record<string, Awaited<ReturnType<typeof measure>>> = {};

// Baseline: the void (no shader sense active after "Manuell"). Ground fauna/flora
// still stream + simulate; this is the world's fixed cost.
rows["void (kein Sinn)"] = await measure(2500);

const senses = [
  "Farben",
  "Echo",
  "Infrarot",
  "UV",
  "Duft",
  "Netzwerk",
  "Motion",
  "Magnetfeld",
  "Rundum",
];
for (const s of senses) {
  await solo(s);
  rows[s] = await measure(2500);
}

console.log("\n════════ PERFORMANCE-PROFIL ════════");
console.log("(headless WebGPU/Metal, 1280×800, über der Spawn-Region)\n");
const pad = (s: string, n: number) => s.padEnd(n);
const padl = (s: string, n: number) => s.padStart(n);
console.log(
  pad("Konfiguration", 20),
  padl("GPU ms", 8),
  padl("Frame ms", 9),
  padl("DrawCalls", 10),
  padl("Dreiecke", 12),
);
console.log("─".repeat(62));
const base = rows["void (kein Sinn)"];
for (const [k, v] of Object.entries(rows)) {
  console.log(
    pad(k, 20),
    padl(v.gpuMs >= 0 ? v.gpuMs.toFixed(2) : "n/a", 8),
    padl(v.frameMs.toFixed(2), 9),
    padl(String(v.drawCalls), 10),
    padl(v.triangles.toLocaleString(), 12),
  );
}
console.log("─".repeat(62));
console.log(`Geometrien im Speicher: ${base.geometries} · Texturen: ${base.textures}`);
console.log("\nΔ gegen void (Sinn-Overhead, GPU ms):");
for (const [k, v] of Object.entries(rows)) {
  if (k.startsWith("void")) continue;
  const d = v.gpuMs - base.gpuMs;
  console.log(
    `  ${pad(k, 18)} ${padl((d >= 0 ? "+" : "") + d.toFixed(2), 7)} ms  (${v.drawCalls - base.drawCalls > 0 ? "+" : ""}${v.drawCalls - base.drawCalls} calls)`,
  );
}

await browser.close();
