// ── Becoming Many — Grass Field Texture (CPU→GPU bridge) ───────
//
// The data-only bridge from CPU worldgen to the GPU grass. A single camera-centred
// RGBA-float texture the compute samples for terrain height + normal + grass mask —
// becoming-many's terrain isn't an analytic GPU function (it's WFC + hydrology baked in
// a worker), so the GPU can't derive any of this itself.
//
//   R = absolute ground height Y     (from `world.groundHeightAt`)
//   G = terrain normal x             (central diff of the painted height grid)
//   B = terrain normal z
//   A = grass mask 0..1              (from FieldsCache.grassMaskAt)
//
// Allocated ONCE and mutated in place (`.image.data` + `needsUpdate`) — a fresh
// DataTexture per repaint would churn the compute bind group (agent-validated). Only
// repainted when the camera crosses a coarse snap cell (or a chunk streams in/out), so
// the CPU cost is a sub-ms paint a few times per second. Read via `textureLoad` + manual
// bilinear (see tsl/terrain-sample.ts), so the filtering mode here is irrelevant.

import * as THREE from "three/webgpu";
import { GRASS_AREA_SIZE } from "./config.ts";

/** Texels per edge. 128² over ~104 m ≈ 0.8 m/texel — plenty for grass base height. */
export const FIELD_TEX_RES = 128;
/** World coverage (m). A margin over the render circle so the snap never uncovers it. */
export const FIELD_COVERAGE = GRASS_AREA_SIZE + 8;
/** Recentre grid step (m). Small enough that the margin always covers the circle. */
const FIELD_SNAP = 2;

/** World ground height at (x,z), or null over not-yet-loaded chunks. */
type GroundHeightFn = (x: number, z: number) => number | null;
/** Grass mask 0..1 at (x,z). */
type MaskFn = (x: number, z: number) => number;

export class GrassFieldTexture {
  readonly texture: THREE.DataTexture;
  readonly res = FIELD_TEX_RES;
  readonly size = FIELD_COVERAGE;
  /** World-XZ min corner of the current coverage (the sampler's `uFieldTexOrigin`). */
  readonly origin = new THREE.Vector2();

  private readonly data: Float32Array;
  private readonly heights: Float32Array;
  private snapX: number | null = null;
  private snapZ: number | null = null;
  private dirty = true;

  constructor() {
    const n = FIELD_TEX_RES * FIELD_TEX_RES;
    this.data = new Float32Array(n * 4);
    this.heights = new Float32Array(n);

    const tex = new THREE.DataTexture(
      this.data,
      FIELD_TEX_RES,
      FIELD_TEX_RES,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    tex.colorSpace = THREE.NoColorSpace; // raw data, not sRGB
    tex.minFilter = THREE.NearestFilter; // manual bilinear in-shader; filter unused
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** Force a repaint on the next `update` (call when a chunk streams in/out). */
  invalidate(): void {
    this.dirty = true;
  }

  /** Recentre + repaint if the camera crossed a snap cell (or was invalidated). Returns
   *  true if it repainted, so the caller can push `origin`/`size` to the uniforms. */
  update(camX: number, camZ: number, ground: GroundHeightFn, maskAt: MaskFn): boolean {
    const cellX = Math.floor(camX / FIELD_SNAP);
    const cellZ = Math.floor(camZ / FIELD_SNAP);
    if (!this.dirty && cellX === this.snapX && cellZ === this.snapZ) return false;
    this.snapX = cellX;
    this.snapZ = cellZ;
    this.dirty = false;

    this.origin.set(cellX * FIELD_SNAP - this.size / 2, cellZ * FIELD_SNAP - this.size / 2);
    this.paint(ground, maskAt);
    this.texture.needsUpdate = true;
    return true;
  }

  private paint(ground: GroundHeightFn, maskAt: MaskFn): void {
    const RES = FIELD_TEX_RES;
    const texel = this.size / RES;
    const ox = this.origin.x;
    const oz = this.origin.y;

    // Pass 1: height (R) + mask (A); stash height for the normal pass.
    for (let j = 0; j < RES; j++) {
      const wz = oz + (j + 0.5) * texel;
      for (let i = 0; i < RES; i++) {
        const wx = ox + (i + 0.5) * texel;
        const idx = j * RES + i;
        const h = ground(wx, wz);
        const height = h ?? 0;
        this.heights[idx] = height;
        const o = idx * 4;
        this.data[o] = height;
        this.data[o + 3] = h === null ? 0 : maskAt(wx, wz);
      }
    }

    // Pass 2: terrain normal (G,B) from central differences of the height grid.
    for (let j = 0; j < RES; j++) {
      const jD = j > 0 ? j - 1 : j;
      const jU = j < RES - 1 ? j + 1 : j;
      for (let i = 0; i < RES; i++) {
        const iL = i > 0 ? i - 1 : i;
        const iR = i < RES - 1 ? i + 1 : i;
        const hL = this.heights[j * RES + iL] ?? 0;
        const hR = this.heights[j * RES + iR] ?? 0;
        const hD = this.heights[jD * RES + i] ?? 0;
        const hU = this.heights[jU * RES + i] ?? 0;
        const dhdx = (hR - hL) / ((iR - iL) * texel);
        const dhdz = (hU - hD) / ((jU - jD) * texel);
        const len = Math.hypot(dhdx, 1, dhdz) || 1;
        const o = (j * RES + i) * 4;
        this.data[o + 1] = -dhdx / len;
        this.data[o + 2] = -dhdz / len;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
