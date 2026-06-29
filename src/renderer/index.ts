import type { Terrain } from "../terrain-generator/index.ts";

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  render(terrain: Terrain): void;
}

/** 2D canvas renderer that paints a terrain heightfield as a grayscale image. */
export function createRenderer(scale = 6): Renderer {
  const canvas = document.createElement("canvas");
  const ctx = require2dContext(canvas);

  function render(terrain: Terrain): void {
    canvas.width = terrain.width;
    canvas.height = terrain.height;
    canvas.style.width = `${terrain.width * scale}px`;
    canvas.style.height = `${terrain.height * scale}px`;

    const image = ctx.createImageData(terrain.width, terrain.height);
    for (const [i, height] of terrain.heights.entries()) {
      const v = Math.round(height * 255);
      const o = i * 4;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  return { canvas, render };
}

function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
  return ctx;
}
