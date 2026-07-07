/**
 * Biome Minimap — a top-down 2D debug overlay hosted inside the dev console (press **C**).
 *
 * Renders each currently-loaded terrain chunk as a tile coloured by its per-vertex biome grid, so
 * you can watch chunk streaming happen and read the biome layout at a glance. Draws chunk boundary
 * lines, a heading arrow at the centre (the player, rotating with the camera), and a hover tooltip
 * naming the biome under the cursor.
 *
 * Self-contained like the dev console: it injects its own styles and owns its own `requestAnimation
 * Frame` loop. It does NOT own a panel or a toggle key — it exposes a `section` element that the dev
 * console hosts (`devConsole.addSection`) and a `setActive` gate wired to the drawer's open state
 * (`devConsole.onOpenChange`), so drawing only runs while the console is visible.
 *
 * Decoupled from terrain internals: it consumes the structural `BiomeChunkSource` view and reads the
 * player pose + heading through a caller-supplied getter — it never imports TerrainWorld, the
 * scheduler, or chunk classes.
 */
import { worldToCell } from "../terrain/coords.ts";
import { biomeProfile } from "../terrain/gen/height/BiomeTerrainProfiles.ts";
import { BIOME_COUNT, Biome } from "../terrain/gen/mapTypes.ts";
import type { BiomeChunkSource } from "../terrain/index.ts";

const STYLE_ID = "mm-styles";

export type MinimapOptions = Readonly<{
  /** Header label appended after the title. */
  label?: string;
  /** Canvas edge in px (square backing store). Default 280 (fits the ~320px drawer). */
  sizePx?: number;
  /** How many chunks span the canvas edge — sets the zoom. Default 5. */
  chunksAcross?: number;
}>;

export interface Minimap {
  /** The section to mount inside the dev console (`devConsole.addSection`). */
  readonly element: HTMLElement;
  /** Start/stop the draw loop — wire to the console's open state. */
  setActive(active: boolean): void;
  /** Stop the loop, remove listeners, and detach the DOM. */
  dispose(): void;
}

/** Player pose + facing, read fresh each frame. `heading = Math.atan2(dir.x, -dir.z)`
 *  (radians; 0 = facing north/−Z, increasing clockwise toward +X). */
export type PoseSource = () => { x: number; z: number; heading: number };

// ── Biome → sRGB palette (precomputed once) ──────────────────────────────────

interface Swatch {
  r: number;
  g: number;
  b: number;
  css: string;
  name: string;
}

const clamp01 = (c: number): number => (c < 0 ? 0 : c > 1 ? 1 : c);
/** Linear-RGB channel [0,1] → sRGB byte [0,255]. Biome colours are stored linear. */
const linearToSrgbByte = (c: number): number => Math.round(clamp01(c) ** (1 / 2.2) * 255);

/** Prettified names for the tooltip + legend (splits the camelCase enum names). */
const BIOME_LABEL: Record<number, string> = {
  [Biome.Ocean]: "Ocean",
  [Biome.Coast]: "Coast",
  [Biome.Beach]: "Beach",
  [Biome.Grassland]: "Grassland",
  [Biome.Forest]: "Forest",
  [Biome.Wetland]: "Wetland",
  [Biome.Desert]: "Desert",
  [Biome.Hills]: "Hills",
  [Biome.RockyMountain]: "Rocky Mountain",
  [Biome.SnowMountain]: "Snow Mountain",
  [Biome.Lake]: "Lake",
  [Biome.River]: "River",
  [Biome.Tundra]: "Tundra",
  [Biome.Taiga]: "Taiga",
};

const FALLBACK_SWATCH: Swatch = {
  r: 128,
  g: 128,
  b: 128,
  css: "rgb(128, 128, 128)",
  name: "Unknown",
};

const PALETTE: Swatch[] = Array.from({ length: BIOME_COUNT }, (_unused, id) => {
  const { color } = biomeProfile(id as Biome);
  const r = linearToSrgbByte(color[0]);
  const g = linearToSrgbByte(color[1]);
  const b = linearToSrgbByte(color[2]);
  return { r, g, b, css: `rgb(${r}, ${g}, ${b})`, name: BIOME_LABEL[id] ?? `Biome ${id}` };
});

const swatchOf = (id: number): Swatch => PALETTE[id] ?? FALLBACK_SWATCH;

// ── Factory ──────────────────────────────────────────────────────────────────

export function createMinimap(
  source: BiomeChunkSource,
  pose: PoseSource,
  options: MinimapOptions = {},
): Minimap {
  injectStyles();

  const size = options.sizePx ?? 280;
  const chunksAcross = options.chunksAcross ?? 5;
  const chunkSize = source.chunkSize;
  const vpe = source.segments + 1; // vertices per chunk edge
  const worldSpan = chunksAcross * chunkSize; // metres across the canvas
  const ppm = size / worldSpan; // canvas px per world metre

  // --- DOM ------------------------------------------------------------------
  const element = document.createElement("section");
  element.className = "mm-section";
  element.innerHTML = SECTION_HTML(options.label ?? "", size);

  const canvas = element.querySelector<HTMLCanvasElement>(".mm-canvas");
  if (!canvas) {
    throw new Error("mm: canvas node missing");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("mm: 2d context unavailable");
  }
  ctx.imageSmoothingEnabled = false; // crisp per-vertex biome cells

  // Legend: one swatch + name per biome.
  const legend = element.querySelector(".mm-legend");
  if (legend) {
    legend.innerHTML = PALETTE.map(
      (sw) => `<div><i style="background:${sw.css}"></i>${sw.name}</div>`,
    ).join("");
  }

  // Tooltip lives on the body (fixed, follows the cursor).
  const tip = document.createElement("div");
  tip.className = "mm-tip";
  document.body.append(tip);

  // --- State ----------------------------------------------------------------
  // Cache one small (vpe × vpe) tile per chunk, painted once from its biome grid.
  const tileCache = new Map<string, HTMLCanvasElement>();
  // Per-render lookup of the drawn biome grids, so hover matches what's on screen.
  const active = new Map<string, Uint8Array>();
  let lastPose = pose();
  let raf = 0;
  let running = false;

  const buildTile = (biome: Uint8Array): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = vpe;
    c.height = vpe;
    const ictx = c.getContext("2d");
    if (!ictx) {
      return c;
    }
    const img = ictx.createImageData(vpe, vpe);
    const d = img.data;
    // Biome grid is row-major vi = j*vpe + i (i→+X, j→+Z). Canvas pixel (i,j) with
    // j downward also = +Z, so the tile maps onto the chunk with no vertical flip.
    for (let vi = 0; vi < vpe * vpe; vi++) {
      const sw = swatchOf(biome[vi] ?? 0);
      const p = vi * 4;
      d[p] = sw.r;
      d[p + 1] = sw.g;
      d[p + 2] = sw.b;
      d[p + 3] = 255;
    }
    ictx.putImageData(img, 0, 0);
    return c;
  };

  const render = (): void => {
    const p = pose();
    lastPose = p;
    ctx.clearRect(0, 0, size, size);

    const cx = (wx: number): number => size / 2 + (wx - p.x) * ppm;
    const cy = (wz: number): number => size / 2 + (wz - p.z) * ppm;

    // Chunk tiles.
    active.clear();
    const seen = new Set<string>();
    const wpx = chunkSize * ppm;
    for (const ch of source.chunks()) {
      if (!ch.biome) {
        continue; // pointwise providers ship no biome grid — nothing to colour
      }
      const key = `${ch.gridX},${ch.gridZ}`;
      seen.add(key);
      active.set(key, ch.biome);
      let tile = tileCache.get(key);
      if (!tile) {
        tile = buildTile(ch.biome);
        tileCache.set(key, tile);
      }
      ctx.drawImage(tile, cx(ch.gridX * chunkSize), cy(ch.gridZ * chunkSize), wpx, wpx);
    }
    // Drop tiles for chunks that streamed out.
    for (const key of tileCache.keys()) {
      if (!seen.has(key)) {
        tileCache.delete(key);
      }
    }

    // Chunk boundary lines.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    const half = worldSpan / 2;
    const firstX = Math.floor((p.x - half) / chunkSize) * chunkSize;
    for (let wx = firstX; wx <= p.x + half; wx += chunkSize) {
      const x = Math.round(cx(wx)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    const firstZ = Math.floor((p.z - half) / chunkSize) * chunkSize;
    for (let wz = firstZ; wz <= p.z + half; wz += chunkSize) {
      const y = Math.round(cy(wz)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    // Heading arrow at centre (rotates with the camera; up = north/−Z at 0 rad).
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(p.heading);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = "#38bdf8";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    render();
  };

  const setActive = (next: boolean): void => {
    if (next === running) {
      return;
    }
    running = next;
    if (running) {
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      raf = 0;
      hideTip();
    }
  };

  // --- Hover tooltip --------------------------------------------------------
  function hideTip(): void {
    tip.style.display = "none";
  }

  const onMove = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    // Canvas may be CSS-scaled; map cursor → backing-store px via the rect.
    const px = ((e.clientX - rect.left) / rect.width) * size;
    const py = ((e.clientY - rect.top) / rect.height) * size;
    const p = lastPose;
    const wx = p.x + (px - size / 2) / ppm;
    const wz = p.z + (py - size / 2) / ppm;
    const gx = worldToCell(wx, chunkSize);
    const gz = worldToCell(wz, chunkSize);
    const biome = active.get(`${gx},${gz}`);
    if (!biome) {
      hideTip();
      return;
    }
    const fx = (wx - gx * chunkSize) / chunkSize;
    const fz = (wz - gz * chunkSize) / chunkSize;
    const i = Math.min(vpe - 1, Math.max(0, Math.round(fx * (vpe - 1))));
    const j = Math.min(vpe - 1, Math.max(0, Math.round(fz * (vpe - 1))));
    const sw = swatchOf(biome[j * vpe + i] ?? 0);
    tip.innerHTML = `<i style="background:${sw.css}"></i>${sw.name}`;
    tip.style.display = "flex";
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 12}px`;
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", hideTip);

  return {
    element,
    setActive,
    dispose(): void {
      setActive(false);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", hideTip);
      element.remove();
      tip.remove();
      tileCache.clear();
    },
  };
}

// --- Markup ------------------------------------------------------------------

const SECTION_HTML = (label: string, size: number): string => `
  <h3 class="mm-h3">Biome Map${label ? ` · ${label}` : ""}</h3>
  <canvas class="mm-canvas" width="${size}" height="${size}"></canvas>
  <div class="mm-legend"></div>
  <div class="mm-hint">hover a cell to name its biome</div>
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
.mm-section { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.mm-h3 { margin: 0 0 8px; font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #71717a; }
.mm-canvas { display: block; width: 100%; max-width: 280px; height: auto; margin: 0 auto; background: #0a0a0f; border: 1px solid rgba(255,255,255,0.08); image-rendering: pixelated; }
.mm-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; margin-top: 10px; }
.mm-legend > div { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-legend i, .mm-tip i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex: 0 0 auto; }
.mm-hint { margin-top: 8px; font-size: 10px; color: #52525b; }
.mm-tip {
  position: fixed; z-index: 10000; pointer-events: none; display: none;
  align-items: center; gap: 6px;
  background: rgba(9,9,11,0.95); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
  padding: 3px 7px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #e6e6e6;
}
`;
