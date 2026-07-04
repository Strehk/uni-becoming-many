/**
 * DevConsole — a togglable developer overlay (press **C**).
 *
 * A slide-in drawer showing live render diagnostics for the WebGPU renderer: FPS (current /
 * average / minimum) with a rolling frame-time graph, CPU + GPU frame time, per-frame render
 * stats (draw calls, triangles, …), GPU resource counts, JS heap, and static context info.
 *
 * Ported from the Svelte `DevConsole` in the neural-flight-template to a self-contained vanilla
 * DOM module: it injects its own styles, builds its own DOM, and runs its own sampling loop, so
 * `createDevConsole(renderer)` is all the wiring needed. Fully removable via the returned
 * `dispose()`.
 *
 * GPU timing: the renderer is created with `trackTimestamp: true`; we wrap `render` to resolve
 * the frame's timestamp queries and surface the elapsed GPU milliseconds (n/a if the device
 * lacks `timestamp-query`).
 */
import type * as THREE from "three/webgpu";

export type DevConsoleOptions = Readonly<{
  /** Human-readable label shown in the header (e.g. the experience name). */
  label?: string;
  /** Start with the drawer open. Defaults to false. */
  open?: boolean;
}>;

export interface DevConsole {
  /** Show/hide the drawer. */
  setOpen(open: boolean): void;
  /** Remove listeners, stop sampling, restore the wrapped `render`, and detach the DOM. */
  dispose(): void;
}

const HISTORY = 120; // frame-time samples kept for the graph (~2 s at 60 fps)
const TEXT_INTERVAL_MS = 120; // throttle number updates to ~8×/s so they stay readable

const STYLE_ID = "devc-styles";

// Frame-time thresholds (ms) → colour. 60 fps ≈ 16.7 ms, 30 fps ≈ 33.3 ms.
const fpsColor = (fps: number): string =>
  fps >= 55 ? "#4ade80" : fps >= 30 ? "#facc15" : "#f87171";

const fmt = (n: number): string => (n >= 1000 ? n.toLocaleString("en-US") : String(n));

/**
 * Mount the dev console overlay for `renderer`. Returns a handle to toggle or remove it.
 */
export function createDevConsole(
  renderer: THREE.WebGPURenderer,
  options: DevConsoleOptions = {},
): DevConsole {
  injectStyles();

  let open = options.open ?? false;

  // --- DOM ------------------------------------------------------------------
  const tab = document.createElement("button");
  tab.className = "devc-tab";
  tab.title = "Dev console (C)";
  tab.textContent = "C";

  const drawer = document.createElement("aside");
  drawer.className = "devc-drawer";
  drawer.innerHTML = DRAWER_HTML(options.label ?? "");
  document.body.append(tab, drawer);

  // Cache the value nodes we update each frame (data-devc="key").
  const node = (key: string): HTMLElement => {
    const found = drawer.querySelector<HTMLElement>(`[data-devc="${key}"]`);
    if (!found) {
      throw new Error(`devc: missing node "${key}"`);
    }
    return found;
  };
  const els = {
    fps: node("fps"),
    fpsAvg: node("fpsAvg"),
    fpsMin: node("fpsMin"),
    cpuMs: node("cpuMs"),
    gpuMs: node("gpuMs"),
    drawCalls: node("drawCalls"),
    triangles: node("triangles"),
    lines: node("lines"),
    points: node("points"),
    geometries: node("geometries"),
    textures: node("textures"),
    heap: node("heap"),
    ctxApi: node("ctxApi"),
    ctxPixelRatio: node("ctxPixelRatio"),
    ctxBuffer: node("ctxBuffer"),
  };
  const linesRow = node("linesRow");
  const pointsRow = node("pointsRow");
  const heapRow = node("heapRow");
  const graph = drawer.querySelector<HTMLCanvasElement>("[data-devc-graph]");

  const setOpen = (next: boolean): void => {
    open = next;
    drawer.classList.toggle("open", open);
    tab.style.display = open ? "none" : "";
  };
  setOpen(open);

  tab.addEventListener("click", () => setOpen(true));
  drawer.querySelector(".devc-close")?.addEventListener("click", () => setOpen(false));

  // --- Static context info (WebGPU) -----------------------------------------
  // The canvas backing store (device pixels) is the drawing-buffer size.
  const canvas = renderer.domElement;
  els.ctxApi.textContent = "WebGPU";
  els.ctxPixelRatio.textContent = `${renderer.getPixelRatio()}×`;
  els.ctxBuffer.textContent = `${canvas.width}×${canvas.height}`;

  // --- GPU timing: wrap render() to resolve timestamp queries per frame ------
  let gpuMs: number | null = null;
  let gpuUpdatedAt = 0;
  const originalRender = renderer.render.bind(renderer);
  const wrappedRender = ((scene: THREE.Scene, camera: THREE.Camera) => {
    const result = originalRender(scene, camera);
    renderer
      .resolveTimestampsAsync()
      .then((ms) => {
        if (typeof ms === "number" && ms > 0) {
          gpuMs = ms;
          gpuUpdatedAt = performance.now();
        }
      })
      .catch(() => {});
    return result;
  }) as typeof renderer.render;
  renderer.render = wrappedRender;

  // --- Sampling loop --------------------------------------------------------
  const frameTimes: number[] = [];
  let raf = 0;
  let lastTime = 0;
  let lastTextUpdate = 0;

  const sample = (now: number): void => {
    raf = requestAnimationFrame(sample);

    const dt = lastTime ? now - lastTime : 16.7;
    lastTime = now;
    frameTimes.push(dt);
    if (frameTimes.length > HISTORY) {
      frameTimes.shift();
    }

    drawGraph();

    if (now - lastTextUpdate < TEXT_INTERVAL_MS) {
      return;
    }
    lastTextUpdate = now;
    updateText(dt, now);
  };

  function updateText(dt: number, now: number): void {
    const sum = frameTimes.reduce((a, b) => a + b, 0);
    const avgMs = sum / frameTimes.length;
    const maxMs = Math.max(...frameTimes);
    const fps = Math.round(1000 / dt);

    els.fps.textContent = String(fps);
    els.fps.style.color = fpsColor(fps);
    els.fpsAvg.textContent = String(Math.round(1000 / avgMs));
    els.fpsMin.textContent = String(Math.round(1000 / maxMs));
    els.cpuMs.textContent = `${dt.toFixed(1)} ms`;

    // GPU ms only when freshly measured (else it's stale → "n/a").
    els.gpuMs.textContent =
      gpuMs !== null && now - gpuUpdatedAt < 1000 ? `${gpuMs.toFixed(2)} ms` : "n/a";

    // `renderer.info`: WebGPU exposes per-frame draw calls as `render.drawCalls`.
    const info = renderer.info;
    const render = info.render as typeof info.render & { drawCalls?: number };
    els.drawCalls.textContent = fmt(render.drawCalls ?? render.calls ?? 0);
    els.triangles.textContent = fmt(render.triangles);
    toggleRow(linesRow, els.lines, render.lines);
    toggleRow(pointsRow, els.points, render.points);
    els.geometries.textContent = fmt(info.memory.geometries);
    els.textures.textContent = fmt(info.memory.textures);

    // performance.memory is a non-standard Chrome-only API.
    const mem = (
      performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
    ).memory;
    if (mem) {
      heapRow.style.display = "";
      els.heap.textContent = `${(mem.usedJSHeapSize / 1048576).toFixed(0)}`;
      els.heap.title = `${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB limit`;
    } else {
      heapRow.style.display = "none";
    }
  }

  function drawGraph(): void {
    if (!graph) {
      return;
    }
    const ctx = graph.getContext("2d");
    if (!ctx) {
      return;
    }
    const w = graph.width;
    const h = graph.height;
    ctx.clearRect(0, 0, w, h);

    const msToY = (ms: number): number => h - (Math.min(ms, 50) / 50) * h;

    // Reference lines at 60 fps (16.7 ms) and 30 fps (33.3 ms).
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    for (const ms of [16.7, 33.3]) {
      const y = msToY(ms);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (frameTimes.length < 2) {
      return;
    }
    const step = w / (HISTORY - 1);
    ctx.beginPath();
    for (let i = 0; i < frameTimes.length; i++) {
      const x = i * step;
      const y = msToY(frameTimes[i] ?? 0);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    const lastMs = frameTimes[frameTimes.length - 1] ?? 0;
    ctx.strokeStyle = lastMs <= 18 ? "#4ade80" : lastMs <= 34 ? "#facc15" : "#f87171";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // --- Toggle key -----------------------------------------------------------
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "c" && e.key !== "C") {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return; // don't hijack Copy etc.
    }
    const el = document.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el as HTMLElement | null)?.isContentEditable
    ) {
      return; // don't toggle while typing
    }
    e.preventDefault();
    setOpen(!open);
  };

  window.addEventListener("keydown", onKeydown);
  raf = requestAnimationFrame(sample);

  return {
    setOpen,
    dispose(): void {
      window.removeEventListener("keydown", onKeydown);
      cancelAnimationFrame(raf);
      renderer.render = originalRender;
      tab.remove();
      drawer.remove();
    },
  };
}

function toggleRow(row: HTMLElement, valueEl: HTMLElement, value: number): void {
  if (value > 0) {
    row.style.display = "";
    valueEl.textContent = fmt(value);
  } else {
    row.style.display = "none";
  }
}

// --- Markup ------------------------------------------------------------------

const metric = (label: string, key: string, attrs = ""): string =>
  `<div class="devc-metric" ${attrs}><span>${label}</span><b data-devc="${key}">–</b></div>`;

const DRAWER_HTML = (label: string): string => `
  <header class="devc-head">
    <span class="devc-title">DEV CONSOLE</span>
    <span class="devc-label">${label || "Renderer"}</span>
    <button class="devc-close" title="Close (C)">✕</button>
  </header>

  <section class="devc-section">
    <div class="devc-fps-row">
      <div class="devc-fps-big"><span data-devc="fps">0</span><small>fps</small></div>
      <div class="devc-fps-sub">
        <div><span>avg</span> <b data-devc="fpsAvg">0</b></div>
        <div><span>min</span> <b data-devc="fpsMin">0</b></div>
      </div>
    </div>
    <canvas data-devc-graph width="280" height="60" class="devc-graph"></canvas>
  </section>

  <section class="devc-section devc-grid">
    ${metric("CPU Frame", "cpuMs")}
    ${metric("GPU Frame", "gpuMs")}
  </section>

  <section class="devc-section">
    <h3 class="devc-h3">Render / Frame</h3>
    <div class="devc-grid">
      ${metric("Draw Calls", "drawCalls")}
      ${metric("Triangles", "triangles")}
      ${metric("Lines", "lines", 'data-devc="linesRow"')}
      ${metric("Points", "points", 'data-devc="pointsRow"')}
    </div>
  </section>

  <section class="devc-section">
    <h3 class="devc-h3">GPU Resources</h3>
    <div class="devc-grid">
      ${metric("Geometries", "geometries")}
      ${metric("Textures", "textures")}
      ${metric("JS Heap (MB)", "heap", 'data-devc="heapRow"')}
    </div>
  </section>

  <section class="devc-section">
    <h3 class="devc-h3">Context</h3>
    <div class="devc-kv"><span>API</span><b data-devc="ctxApi">–</b></div>
    <div class="devc-kv"><span>Pixel Ratio</span><b data-devc="ctxPixelRatio">–</b></div>
    <div class="devc-kv"><span>Buffer</span><b data-devc="ctxBuffer">–</b></div>
  </section>

  <footer class="devc-foot"><kbd>C</kbd> open / close</footer>
`;

// --- Styles (injected once) --------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const CSS = `
.devc-tab {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%); z-index: 9998;
  width: 24px; height: 48px; padding: 0;
  background: rgba(24,24,27,0.9); border: 1px solid rgba(255,255,255,0.12); border-right: none;
  color: #a1a1aa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; font-weight: 700; cursor: pointer; opacity: 0.5; transition: opacity 0.15s;
}
.devc-tab:hover { opacity: 1; color: #38bdf8; }

.devc-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 9999;
  width: 320px; max-width: 90vw; display: flex; flex-direction: column;
  background: rgba(9,9,11,0.92); backdrop-filter: blur(8px);
  border-left: 1px solid rgba(255,255,255,0.12); color: #e6e6e6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  transform: translateX(100%); transition: transform 0.22s cubic-bezier(0.4,0,0.2,1);
  overflow-y: auto;
}
.devc-drawer.open { transform: translateX(0); }

.devc-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.08); position: sticky; top: 0;
  background: rgba(9,9,11,0.95); z-index: 1;
}
.devc-title { font-weight: 700; letter-spacing: 0.08em; color: #38bdf8; }
.devc-label { flex: 1; color: #71717a; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.devc-close { background: none; border: none; color: #a1a1aa; cursor: pointer; font-size: 13px; padding: 2px 4px; }
.devc-close:hover { color: #f87171; }

.devc-section { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.devc-h3 { margin: 0 0 8px; font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #71717a; }

.devc-fps-row { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; }
.devc-fps-big { font-size: 36px; font-weight: 700; line-height: 1; }
.devc-fps-big small { font-size: 13px; font-weight: 400; color: #71717a; margin-left: 4px; }
.devc-fps-sub { display: flex; flex-direction: column; gap: 2px; color: #a1a1aa; }
.devc-fps-sub span { color: #71717a; display: inline-block; width: 26px; }

.devc-graph { width: 100%; height: 60px; display: block; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); }

.devc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.devc-metric { display: flex; flex-direction: column; gap: 2px; }
.devc-metric span { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
.devc-metric b { font-size: 15px; font-weight: 600; color: #e6e6e6; }

.devc-kv { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
.devc-kv span { color: #71717a; flex-shrink: 0; }
.devc-kv b { font-weight: 500; color: #a1a1aa; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.devc-foot { margin-top: auto; padding: 8px 12px; color: #71717a; font-size: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
.devc-foot kbd { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 2px; padding: 1px 5px; color: #a1a1aa; }
`;
