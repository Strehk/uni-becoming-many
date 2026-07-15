// ── SENSE MODULE: Netzwerk — the root web in the ground ────────
//
// Replaces the mushroom-only mycelium: the collective's underground web grows as
// ROOTS from every rooted plant (trees, bushes, mushrooms) and joins them into
// one network. The layout is solved by WAVE FUNCTION COLLAPSE, block by block:
//
//   - the world is partitioned into FIXED blocks of 16×16 grid cells; each block
//     solves its own WFC seeded from its world coordinates — fully deterministic,
//     so a rebuild reproduces every visible block bit-for-bit and the web never
//     "jumps" while flying (only rim blocks pop in/out, hidden by the view fade);
//   - the tileset is the 16 N/E/S/W connection bitmasks ("pipes" WFC), the
//     adjacency constraint is edge matching (a connection must be answered);
//   - block borders are decided by a deterministic edge hash both neighbours
//     compute identically — the web flows seamlessly across block seams;
//   - cells under plants collapse FIRST, to hubs sized by plant kind
//     (tree/bush/mushroom — each tunable), so roots visibly start there;
//   - the rest collapses lowest-entropy-first; tile weights come from `density`
//     (fill falls off with distance to the nearest plant), `branchiness`
//     (T/X junctions) and `tips` (dead ends = root tips);
//   - contradictions resolve to the tile forced by collapsed neighbours;
//   - a per-block post-pass bridges disconnected patches.
//
// The collapsed grid renders as root strands hugging the ground skin: bundles fan
// out between nodes and rejoin at them, meander sideways, ripple with a small
// relief and thin out (taper) with graph distance from the nearest plant. The
// strands use the HARDWARE depth test, so trees, rocks and hills standing in
// front correctly occlude the web (three's WebGPU line material supports neither
// a custom frag-depth nor a mid-pass scene-depth read, so a selective "x-ray
// through soil but not through objects" isn't available — the strands therefore
// sit just above the solid ground rather than buried under it). A `viewDistance`
// uniform fades the web out softly around the player. Hotspot pulses travel the
// strands in the shader (phase attribute + time uniform); a per-vertex
// `strength` attribute carries the taper into the material.
//
// IMPORTANT — see AGENT.md "WebGPU rendering": node fns from `three/tsl`, classes
// from `three/webgpu`. No GLSL.

import { attribute, float, positionWorld, sin, smoothstep, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import type { RootAnchor } from "../../life/index.ts";

export interface RootsOptions {
  /** Horizontal coverage of the root field around the player (m). Structural. */
  radius: number;
  /** WFC grid cell size (m) — smaller cells = finer, denser web. Structural. */
  cellSize: number;
  /** 0..1 — how much of the field fills with roots (empty-tile weight falls). */
  density: number;
  /** 0..1 — weight of T- and X-junction tiles (how much the roots fork). */
  branchiness: number;
  /** 0..1 — weight of dead-end tiles (loose root tips). */
  tips: number;
  /** Bridge disconnected patches inside each block after the collapse. */
  connectAll: boolean;
  /** WFC random seed — same seed + same plants = same web. */
  seed: number;
  /** Connections seeded under a tree / bush / mushroom (0 = none, 4 = full hub). */
  treeHub: number;
  bushHub: number;
  mushroomHub: number;
  /** Max parallel strands per root run (thickness near the plants). */
  strands: number;
  /** Sideways fan-out between the strands of a bundle (m). */
  strandSpread: number;
  /** Sideways meander amplitude of a root run (m). */
  wiggle: number;
  /** Vertical relief of the strands above the ground skin (m) — a small organic
   *  rise/fall. Kept positive so the depth test shows the web over its own
   *  terrain while trees/rocks/hills in front still occlude it. */
  depth: number;
  /** 0..1 — how quickly roots thin out per graph step away from a plant. */
  taper: number;
  /** Polyline segments per cell edge. Structural. */
  segments: number;
  /** Soft view-distance fade around the player (m). Live. */
  viewDistance: number;
  baseColor: string;
  hotspotColor: string;
  baseAlpha: number;
  hotspotAlpha: number;
  hotspotStrength: number;
  hotspotSpeed: number;
}

export const ROOTS_DEFAULTS: RootsOptions = {
  radius: 110,
  cellSize: 7,
  density: 0.6,
  branchiness: 0.5,
  tips: 0.35,
  connectAll: true,
  seed: 7,
  treeHub: 4,
  bushHub: 2,
  mushroomHub: 3,
  strands: 4,
  strandSpread: 0.55,
  wiggle: 1.8,
  depth: 1.6,
  taper: 0.5,
  segments: 10,
  viewDistance: 90,
  baseColor: "#8f6134",
  hotspotColor: "#eaffb0",
  baseAlpha: 0.8,
  hotspotAlpha: 0.75,
  hotspotStrength: 2.8,
  hotspotSpeed: 4.8,
};

/** Options whose change requires re-running the WFC / rebuilding geometry. */
export const ROOTS_STRUCTURAL: ReadonlySet<keyof RootsOptions> = new Set([
  "radius",
  "cellSize",
  "density",
  "branchiness",
  "tips",
  "connectAll",
  "seed",
  "treeHub",
  "bushHub",
  "mushroomHub",
  "strands",
  "strandSpread",
  "wiggle",
  "depth",
  "taper",
  "segments",
] satisfies (keyof RootsOptions)[]);

/** Grid cells per world block side — blocks are the deterministic WFC unit. */
const BLOCK_CELLS = 16;
/** Depth assigned to web parts no plant reaches (border corridors) — thin. */
const UNROOTED_DEPTH = 10;

// ── WFC tileset: connection bitmasks N=1, E=2, S=4, W=8 ────────
const DIR_DX = [0, 1, 0, -1] as const;
const DIR_DZ = [-1, 0, 1, 0] as const;
const DIR_BIT = [1, 2, 4, 8] as const;
const OPPOSITE = [2, 3, 0, 1] as const;
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;
const FULL_DOMAIN = 0xffff; // all 16 tiles possible

/** Deterministic PRNG — the WFC must reproduce for a given seed + block. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 hash for a grid EDGE in world cell coordinates — both
 *  blocks sharing the edge compute the same value, so seams always match.
 *  `axis` 0 = horizontal edge (cell → east), 1 = vertical edge (cell → south). */
function edgeHash01(cellX: number, cellZ: number, axis: number, seed: number): number {
  let h =
    Math.imul(cellX, 73856093) ^
    Math.imul(cellZ, 19349663) ^
    Math.imul(axis + 1, 83492791) ^
    Math.imul(seed | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface RootsMaterialHandle {
  material: THREE.LineBasicNodeMaterial;
  color: { value: THREE.Color };
  baseAlpha: { value: number };
  glowStrength: { value: number };
  hotspotSpeed: { value: number };
}

type FloatUniform = ReturnType<typeof floatUniform>;
function floatUniform(v: number) {
  return uniform(v);
}
type Vec3Uniform = ReturnType<typeof vec3Uniform>;
function vec3Uniform() {
  return uniform(new THREE.Vector3());
}

function createRootsMaterial(
  colorHex: string,
  baseAlphaValue: number,
  glowStrengthValue: number,
  constantBase: boolean,
  hotspotSpeedValue: number,
  uTime: FloatUniform,
  uFade: FloatUniform,
  uPlayerPos: Vec3Uniform,
  uViewDistance: FloatUniform,
): RootsMaterialHandle {
  const material = new THREE.LineBasicNodeMaterial();
  material.transparent = true;
  // Base strands blend normally (dark roots must read on the bright void terrain
  // too — additive would vanish on white); only the hotspot glow adds light.
  material.blending = constantBase ? THREE.NormalBlending : THREE.AdditiveBlending;
  material.depthWrite = false;
  // Hardware depth test ON: the strands run in the topsoil skin just under the
  // surface, so trees, rocks and hills standing in front of them correctly
  // occlude the web (its own thin covering of earth/grass does not — the strands
  // sit on top of the solid ground mesh, only dipping into it at the nodes). This
  // is the engine-honest way to get "hidden behind objects, visible on the
  // ground": three's WebGPU line material honours neither a custom frag-depth
  // (depthNode) nor a mid-pass scene-depth read, so a true selective x-ray isn't
  // available here.
  material.depthTest = true;
  material.toneMapped = false;

  const color = uniform(new THREE.Color(colorHex));
  const baseAlpha = uniform(baseAlphaValue);
  const glowStrength = uniform(glowStrengthValue);
  const hotspotSpeed = uniform(hotspotSpeedValue);
  const strength = attribute<"float">("strength", "float");

  // Soft view-distance fade around the player (Sichtweite).
  const viewFade = float(1).sub(
    smoothstep(uViewDistance.mul(0.65), uViewDistance, positionWorld.sub(uPlayerPos).length()),
  );

  const alpha = uFade.mul(strength).mul(viewFade);
  if (constantBase) {
    material.colorNode = color;
    material.opacityNode = float(baseAlpha).mul(alpha);
  } else {
    const phase = attribute<"float">("phase", "float");
    const movingHotspot = sin(phase.mul(38.0).sub(uTime.mul(hotspotSpeed)));
    const localHotspot = sin(phase.mul(93.0).add(uTime.mul(0.42)));
    const pulse = smoothstep(0.93, 1.0, movingHotspot.mul(0.72).add(localHotspot.mul(0.28)));
    material.colorNode = color.mul(pulse.mul(glowStrength).add(1.0));
    material.opacityNode = pulse.mul(baseAlpha).mul(alpha);
  }
  return { material, color, baseAlpha, glowStrength, hotspotSpeed };
}

/** One solved world block's strand geometry, cached for seamless rebuilds. */
interface SolvedBlock {
  positions: Float32Array;
  phases: Float32Array;
  strengths: Float32Array;
  /** Whether any plant seeded this block — anchorless blocks are re-solved so
   *  they pick up flora that streams in later (deterministic, so no popping). */
  anchored: boolean;
}

export class RootsNetwork {
  readonly group: THREE.Group;
  /** Sense-layer fade 0..1 — scales the strand opacities. */
  readonly fade = floatUniform(0);

  private options: RootsOptions;
  private readonly heightAt: (x: number, z: number) => number | null;
  private readonly anchorsIn: (x: number, z: number, radius: number) => readonly RootAnchor[];
  private readonly waterAt: (x: number, z: number) => boolean;
  private readonly time = floatUniform(0);
  private readonly playerPos = vec3Uniform();
  private readonly viewDistance = floatUniform(ROOTS_DEFAULTS.viewDistance);

  private readonly blocks = new Map<string, SolvedBlock>();
  private lastBlockX = Number.NaN;
  private lastBlockZ = Number.NaN;

  private readonly base: RootsMaterialHandle;
  private readonly glow: RootsMaterialHandle;
  private baseGeometry: THREE.BufferGeometry;
  private glowGeometry: THREE.BufferGeometry;
  private readonly baseLines: THREE.LineSegments;
  private readonly glowLines: THREE.LineSegments;

  constructor(
    heightAt: (x: number, z: number) => number | null,
    anchorsIn: (x: number, z: number, radius: number) => readonly RootAnchor[],
    waterAt: (x: number, z: number) => boolean,
    options: Partial<RootsOptions> = {},
  ) {
    this.heightAt = heightAt;
    this.anchorsIn = anchorsIn;
    this.waterAt = waterAt;
    this.options = { ...ROOTS_DEFAULTS, ...options };
    this.viewDistance.value = this.options.viewDistance;
    this.group = new THREE.Group();
    this.group.name = "roots-network";

    this.base = createRootsMaterial(
      this.options.baseColor,
      this.options.baseAlpha,
      1,
      true,
      this.options.hotspotSpeed,
      this.time,
      this.fade,
      this.playerPos,
      this.viewDistance,
    );
    this.glow = createRootsMaterial(
      this.options.hotspotColor,
      this.options.hotspotAlpha,
      this.options.hotspotStrength,
      false,
      this.options.hotspotSpeed,
      this.time,
      this.fade,
      this.playerPos,
      this.viewDistance,
    );

    this.baseGeometry = new THREE.BufferGeometry();
    this.glowGeometry = new THREE.BufferGeometry();
    this.baseLines = new THREE.LineSegments(this.baseGeometry, this.base.material);
    this.glowLines = new THREE.LineSegments(this.glowGeometry, this.glow.material);
    this.glowLines.position.y = 0.04;
    // Transparent web draws after opaque; the depth test still occludes it behind
    // solid geometry, so order only sequences base under glow.
    this.baseLines.renderOrder = 900;
    this.glowLines.renderOrder = 901;
    this.baseLines.frustumCulled = false;
    this.glowLines.frustumCulled = false;
    this.group.add(this.baseLines, this.glowLines);
  }

  setOptions(options: Partial<RootsOptions>): void {
    this.options = { ...this.options, ...options };
    this.base.color.value.set(this.options.baseColor);
    this.base.baseAlpha.value = this.options.baseAlpha;
    this.glow.color.value.set(this.options.hotspotColor);
    this.glow.baseAlpha.value = this.options.hotspotAlpha;
    this.glow.glowStrength.value = this.options.hotspotStrength;
    this.glow.hotspotSpeed.value = this.options.hotspotSpeed;
    this.viewDistance.value = this.options.viewDistance;
  }

  get currentOptions(): Readonly<RootsOptions> {
    return this.options;
  }

  /** Drop every solved block — the next `rebuildIfNeeded` re-solves fresh.
   *  Call after structural option changes or flora re-scatters. */
  invalidate(): void {
    this.blocks.clear();
    this.lastBlockX = Number.NaN;
    this.lastBlockZ = Number.NaN;
  }

  /** Advance the shader clock and the view-fade centre. Call every frame. */
  update(_delta: number, elapsed: number, px: number, py: number, pz: number): void {
    this.time.value = elapsed;
    this.playerPos.value.set(px, py, pz);
  }

  /** Re-assemble the visible block set when the player crossed into another
   *  world block (or `force`). Cached blocks reproduce exactly — no jumping.
   *  Returns the number of plant-anchored blocks, or -1 if nothing was done. */
  rebuildIfNeeded(px: number, pz: number, force: boolean): number {
    const blockSize = this.options.cellSize * BLOCK_CELLS;
    const bx = Math.floor(px / blockSize);
    const bz = Math.floor(pz / blockSize);
    if (!force && bx === this.lastBlockX && bz === this.lastBlockZ) {
      return -1;
    }
    this.lastBlockX = bx;
    this.lastBlockZ = bz;

    // Blocks whose centre lies within radius (+ margin) of the player block centre.
    const reach = this.options.radius + blockSize * 0.75;
    const span = Math.ceil(reach / blockSize);
    const centerX = (bx + 0.5) * blockSize;
    const centerZ = (bz + 0.5) * blockSize;
    const needed = new Set<string>();
    let anchoredBlocks = 0;
    const parts: SolvedBlock[] = [];

    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const bxi = bx + dx;
        const bzi = bz + dz;
        const mx = (bxi + 0.5) * blockSize - centerX;
        const mz = (bzi + 0.5) * blockSize - centerZ;
        if (mx * mx + mz * mz > reach * reach) continue;
        const key = `${bxi},${bzi}`;
        needed.add(key);
        let solved = this.blocks.get(key);
        // Anchorless blocks re-solve (deterministic) so late-streaming flora shows up.
        if (!solved || !solved.anchored) {
          solved = this.solveBlock(bxi, bzi);
          if (solved.anchored) this.blocks.set(key, solved);
          else this.blocks.delete(key);
        }
        if (solved.anchored) anchoredBlocks++;
        parts.push(solved);
      }
    }

    // Evict blocks that left the coverage circle.
    for (const key of this.blocks.keys()) {
      if (!needed.has(key)) this.blocks.delete(key);
    }

    // Concatenate the block geometries into the two line meshes.
    let total = 0;
    for (const p of parts) total += p.positions.length;
    const positions = new Float32Array(total);
    const phases = new Float32Array(total / 3);
    const strengths = new Float32Array(total / 3);
    let off = 0;
    for (const p of parts) {
      positions.set(p.positions, off);
      phases.set(p.phases, off / 3);
      strengths.set(p.strengths, off / 3);
      off += p.positions.length;
    }

    console.debug(
      `[netzwerk] root web: ${parts.length} blocks (${anchoredBlocks} anchored), ${total / 6} line segments`,
    );

    this.baseGeometry.dispose();
    this.glowGeometry.dispose();
    this.baseGeometry = new THREE.BufferGeometry();
    this.baseGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.baseGeometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    this.baseGeometry.setAttribute("strength", new THREE.BufferAttribute(strengths, 1));
    this.glowGeometry = this.baseGeometry.clone();
    this.baseLines.geometry = this.baseGeometry;
    this.glowLines.geometry = this.glowGeometry;
    return anchoredBlocks;
  }

  // ── one block: WFC solve → bridge → taper depths → strand geometry ──
  private solveBlock(bxi: number, bzi: number): SolvedBlock {
    const o = this.options;
    const n = BLOCK_CELLS;
    const cells = n * n;
    const blockSize = o.cellSize * n;
    const originX = bxi * blockSize;
    const originZ = bzi * blockSize;
    const cellX = (i: number): number => originX + ((i % n) + 0.5) * o.cellSize;
    const cellZ = (i: number): number => originZ + (Math.floor(i / n) + 0.5) * o.cellSize;

    // Deterministic per block — a rebuild reproduces this block exactly.
    const rng = mulberry32((o.seed * 0x9e3779b9) ^ (bxi * 73856093) ^ (bzi * 19349663));

    // Plants inside this block: strongest wins a cell; remember all for tendrils.
    const blockAnchors = this.anchorsIn(
      originX + blockSize * 0.5,
      originZ + blockSize * 0.5,
      blockSize * 0.75,
    ).filter(
      (a) =>
        a.x >= originX && a.x < originX + blockSize && a.z >= originZ && a.z < originZ + blockSize,
    );
    const hubOf = (kind: RootAnchor["kind"]): number =>
      kind === "tree" ? o.treeHub : kind === "bush" ? o.bushHub : o.mushroomHub;
    const hubAt = new Map<number, number>();
    const plantsAt = new Map<number, RootAnchor[]>();
    for (const a of blockAnchors) {
      const gx = Math.floor((a.x - originX) / o.cellSize);
      const gz = Math.floor((a.z - originZ) / o.cellSize);
      if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
      const hub = Math.max(0, Math.min(4, Math.round(hubOf(a.kind))));
      if (hub <= 0) continue;
      const i = gz * n + gx;
      hubAt.set(i, Math.max(hubAt.get(i) ?? 0, hub));
      const list = plantsAt.get(i);
      if (list) list.push(a);
      else plantsAt.set(i, [a]);
    }

    // Distance-to-nearest-plant factor per cell (0 at a plant, 1 far away).
    const falloff = Math.max(1, blockSize * 0.75);
    const distFactor = new Float32Array(cells).fill(1);
    if (blockAnchors.length > 0) {
      for (let i = 0; i < cells; i++) {
        const x = cellX(i);
        const z = cellZ(i);
        let best = Number.POSITIVE_INFINITY;
        for (const a of blockAnchors) {
          const dx = a.x - x;
          const dz = a.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
        }
        distFactor[i] = Math.min(1, Math.sqrt(best) / falloff);
      }
    }

    // Water mask: no roots grow through lakes / rivers / the sea.
    const water = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      water[i] = this.waterAt(cellX(i), cellZ(i)) ? 1 : 0;
    }

    const tiles = this.wfcCollapse(n, bxi, bzi, hubAt, distFactor, water, rng);
    if (o.connectAll) bridgeComponents(tiles, n, water);

    // Taper depths: BFS from every plant cell over the final connection graph.
    const depth = new Int32Array(cells).fill(-1);
    const queue: number[] = [];
    for (const i of hubAt.keys()) {
      if ((tiles[i] ?? 0) > 0) {
        depth[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q] ?? 0;
      const t = tiles[i] ?? 0;
      const gx = i % n;
      const gz = Math.floor(i / n);
      for (let d = 0; d < 4; d++) {
        if ((t & (DIR_BIT[d] ?? 0)) === 0) continue;
        const nx = gx + (DIR_DX[d] ?? 0);
        const nz = gz + (DIR_DZ[d] ?? 0);
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        if (depth[j] === -1) {
          depth[j] = (depth[i] ?? 0) + 1;
          queue.push(j);
        }
      }
    }

    // ── geometry: one strand bundle per connected edge + tendrils per plant ──
    const positions: number[] = [];
    const phases: number[] = [];
    const strengths: number[] = [];
    const thinning = 1 - 0.55 * o.taper;
    const depthOr = (i: number): number => {
      const d = depth[i] ?? -1;
      return d === -1 ? UNROOTED_DEPTH : d;
    };

    for (let i = 0; i < cells; i++) {
      const t = tiles[i] ?? 0;
      if (t === 0) continue;
      const gx = i % n;
      const gz = Math.floor(i / n);
      const worldCellX = bxi * n + gx;
      const worldCellZ = bzi * n + gz;
      // East + South edges only — each undirected edge drawn once. Edges leaving
      // the block eastward/southward are drawn by THIS block up to the seam cell
      // centre in the neighbour (same hash ⇒ the neighbour's tile answers).
      for (const d of [1, 2]) {
        if ((t & (DIR_BIT[d] ?? 0)) === 0) continue;
        const nx = gx + (DIR_DX[d] ?? 0);
        const nz = gz + (DIR_DZ[d] ?? 0);
        const inBlock = nx >= 0 && nz >= 0 && nx < n && nz < n;
        const j = nz * n + nx;
        const jDepth = inBlock ? depthOr(j) : UNROOTED_DEPTH;
        const stepDepth = Math.min(depthOr(i), jDepth);
        const fall = Math.max(0.12, thinning ** stepDepth);
        const strandCount = Math.max(1, Math.round(o.strands * fall));
        const phase = ((worldCellX * 7349 + worldCellZ * 9151 + d * 517) % 1000) * 0.0173;
        const endX = cellX(i) + (DIR_DX[d] ?? 0) * o.cellSize;
        const endZ = cellZ(i) + (DIR_DZ[d] ?? 0) * o.cellSize;
        this.addRootRun(
          positions,
          phases,
          strengths,
          cellX(i),
          cellZ(i),
          endX,
          endZ,
          phase,
          strandCount,
          0.3 + 0.7 * fall,
          false,
        );
      }
    }

    // Tendrils: from each plant's foot to its cell's connected edge midpoints —
    // the roots visibly START under the trunk/stem and dive into the web.
    for (const [i, plants] of plantsAt) {
      const t = tiles[i] ?? 0;
      const cx = cellX(i);
      const cz = cellZ(i);
      for (const plant of plants) {
        let targets = 0;
        for (let d = 0; d < 4; d++) {
          if ((t & (DIR_BIT[d] ?? 0)) === 0) continue;
          targets++;
          const phase = ((i * 131 + d * 977) % 1000) * 0.0191 + plant.scale;
          this.addRootRun(
            positions,
            phases,
            strengths,
            plant.x,
            plant.z,
            cx + (DIR_DX[d] ?? 0) * o.cellSize * 0.5,
            cz + (DIR_DZ[d] ?? 0) * o.cellSize * 0.5,
            phase,
            Math.max(1, o.strands),
            1,
            true,
          );
        }
        if (targets === 0) {
          // Isolated cell (hub 0-collapsed away): still show a rootlet to the centre.
          this.addRootRun(
            positions,
            phases,
            strengths,
            plant.x,
            plant.z,
            cx,
            cz,
            (i % 1000) * 0.0191,
            1,
            0.6,
            true,
          );
        }
      }
    }

    return {
      positions: Float32Array.from(positions),
      phases: Float32Array.from(phases),
      strengths: Float32Array.from(strengths),
      anchored: hubAt.size > 0,
    };
  }

  /** Standard WFC over one block: border edges are FORCED by the deterministic
   *  edge hash (both neighbours agree), plant hubs seed first, then
   *  lowest-entropy-first collapse with edge-matching propagation. Never throws —
   *  contradictions resolve to the tile forced by already-collapsed neighbours. */
  private wfcCollapse(
    n: number,
    bxi: number,
    bzi: number,
    hubAt: ReadonlyMap<number, number>,
    distFactor: Float32Array,
    water: Uint8Array,
    rng: () => number,
  ): Uint8Array {
    const o = this.options;
    const cells = n * n;
    const blockSize = o.cellSize * n;
    const domain = new Uint16Array(cells).fill(FULL_DOMAIN);

    // Water cells are forced empty — the web routes around lakes and rivers.
    for (let i = 0; i < cells; i++) {
      if ((water[i] ?? 0) !== 0) domain[i] = 1 << 0;
    }

    // Border: every edge crossing the block seam is decided by the shared hash
    // (gated on water on BOTH sides — the neighbour block computes the same).
    const borderP = 0.08 + 0.32 * o.density;
    for (let i = 0; i < cells; i++) {
      if ((water[i] ?? 0) !== 0) continue; // already forced empty
      const gx = i % n;
      const gz = Math.floor(i / n);
      if (gx !== 0 && gz !== 0 && gx !== n - 1 && gz !== n - 1) continue;
      const worldCellX = bxi * n + gx;
      const worldCellZ = bzi * n + gz;
      let d = domain[i] ?? FULL_DOMAIN;
      for (let dir = 0; dir < 4; dir++) {
        const nx = gx + (DIR_DX[dir] ?? 0);
        const nz = gz + (DIR_DZ[dir] ?? 0);
        if (nx >= 0 && nz >= 0 && nx < n && nz < n) continue; // inner edge
        // Canonical edge key: horizontal edges keyed on their west cell,
        // vertical edges on their north cell.
        const hx = dir === 3 ? worldCellX - 1 : worldCellX;
        const hz = dir === 0 ? worldCellZ - 1 : worldCellZ;
        const axis = dir === 1 || dir === 3 ? 0 : 1;
        // The neighbour cell's centre in world space (it lies in the next block).
        const nwx = bxi * blockSize + (gx + (DIR_DX[dir] ?? 0) + 0.5) * o.cellSize;
        const nwz = bzi * blockSize + (gz + (DIR_DZ[dir] ?? 0) + 0.5) * o.cellSize;
        const connected = edgeHash01(hx, hz, axis, o.seed) < borderP && !this.waterAt(nwx, nwz);
        const bit = DIR_BIT[dir] ?? 0;
        for (let t = 0; t < 16; t++) {
          if (((t & bit) !== 0) !== connected) d &= ~(1 << t);
        }
      }
      domain[i] = d;
    }

    const weightOf = (tile: number, i: number): number => {
      const pop = POPCOUNT[tile] ?? 0;
      const df = distFactor[i] ?? 1;
      if (pop === 0) return 0.35 + 5 * df * df + (1 - o.density) * 3;
      if (pop === 1) return 0.25 + o.tips * 1.1;
      if (pop === 2) return 1;
      if (pop === 3) return 0.12 + o.branchiness * 1.5;
      return 0.06 + o.branchiness * 0.9;
    };

    const propagate = (start: number): void => {
      const queue = [start];
      while (queue.length > 0) {
        const i = queue.pop() ?? 0;
        const di = domain[i] ?? 0;
        const gx = i % n;
        const gz = Math.floor(i / n);
        for (let dir = 0; dir < 4; dir++) {
          const nx = gx + (DIR_DX[dir] ?? 0);
          const nz = gz + (DIR_DZ[dir] ?? 0);
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const j = nz * n + nx;
          const bit = DIR_BIT[dir] ?? 0;
          let canOn = false;
          let canOff = false;
          for (let t = 0; t < 16; t++) {
            if ((di & (1 << t)) === 0) continue;
            if ((t & bit) !== 0) canOn = true;
            else canOff = true;
          }
          const oppBit = DIR_BIT[OPPOSITE[dir] ?? 0] ?? 0;
          let dj = domain[j] ?? 0;
          const before = dj;
          if (!canOn) {
            for (let t = 0; t < 16; t++) {
              if ((t & oppBit) !== 0) dj &= ~(1 << t);
            }
          }
          if (!canOff) {
            for (let t = 0; t < 16; t++) {
              if ((t & oppBit) === 0) dj &= ~(1 << t);
            }
          }
          if (dj === before) continue;
          if (dj === 0) {
            // Contradiction: force the tile the collapsed neighbours demand.
            let forced = 0;
            for (let d2 = 0; d2 < 4; d2++) {
              const mx = nx + (DIR_DX[d2] ?? 0);
              const mz = nz + (DIR_DZ[d2] ?? 0);
              if (mx < 0 || mz < 0 || mx >= n || mz >= n) continue;
              const m = mz * n + mx;
              const dm = domain[m] ?? 0;
              const mOpp = DIR_BIT[OPPOSITE[d2] ?? 0] ?? 0;
              // Neighbour insists on a connection only if EVERY remaining tile has it.
              let allOn = dm !== 0;
              for (let t = 0; t < 16; t++) {
                if ((dm & (1 << t)) !== 0 && (t & mOpp) === 0) allOn = false;
              }
              if (allOn) forced |= DIR_BIT[d2] ?? 0;
            }
            dj = 1 << forced;
          }
          domain[j] = dj;
          queue.push(j);
        }
      }
    };

    // Border forcings must propagate before anything collapses.
    for (let i = 0; i < cells; i++) {
      if ((domain[i] ?? FULL_DOMAIN) !== FULL_DOMAIN) propagate(i);
    }

    // 1. Seed the plant hubs (largest hubs first — trees claim their shape early).
    const seeds = [...hubAt.entries()].sort((a, b) => b[1] - a[1]);
    for (const [i, hub] of seeds) {
      const di = domain[i] ?? 0;
      let exact = 0;
      let atLeast = 0;
      for (let t = 0; t < 16; t++) {
        if ((di & (1 << t)) === 0) continue;
        if ((POPCOUNT[t] ?? 0) === hub) exact |= 1 << t;
        if ((POPCOUNT[t] ?? 0) >= 1) atLeast |= 1 << t;
      }
      const pool = exact !== 0 ? exact : atLeast;
      if (pool === 0) continue;
      const picks: number[] = [];
      for (let t = 0; t < 16; t++) {
        if ((pool & (1 << t)) !== 0) picks.push(t);
      }
      const tile = picks[Math.floor(rng() * picks.length)] ?? 0;
      domain[i] = 1 << tile;
      propagate(i);
    }

    // 2. Lowest-entropy-first collapse of everything else.
    for (;;) {
      let best = -1;
      let bestCount = 17;
      for (let i = 0; i < cells; i++) {
        const di = domain[i] ?? 0;
        const count = POPCOUNT16(di);
        if (count > 1 && (count < bestCount || (count === bestCount && rng() < 0.2))) {
          best = i;
          bestCount = count;
        }
      }
      if (best === -1) break;
      const di = domain[best] ?? 0;
      let total = 0;
      for (let t = 0; t < 16; t++) {
        if ((di & (1 << t)) !== 0) total += weightOf(t, best);
      }
      let pick = rng() * total;
      let tile = 0;
      for (let t = 0; t < 16; t++) {
        if ((di & (1 << t)) === 0) continue;
        pick -= weightOf(t, best);
        tile = t;
        if (pick <= 0) break;
      }
      domain[best] = 1 << tile;
      propagate(best);
    }

    // Read out the collapsed tiles.
    const tiles = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      const di = domain[i] ?? 0;
      for (let t = 0; t < 16; t++) {
        if ((di & (1 << t)) !== 0) {
          tiles[i] = t;
          break;
        }
      }
    }
    return tiles;
  }

  /** One meandering root bundle from (x0,z0) to (x1,z1): `strandCount` strands fan
   *  apart mid-run and rejoin at both ends, every sample follows the terrain but
   *  runs `depth` below it (x-ray view). `diveFromSurface` starts the bundle AT
   *  the surface (a root emerging at a trunk) and dives it down to web depth. */
  private addRootRun(
    positions: number[],
    phases: number[],
    strengths: number[],
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    phaseOffset: number,
    strandCount: number,
    strength: number,
    diveFromSurface: boolean,
  ): void {
    const o = this.options;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const px = -dz / len;
    const pz = dx / len;
    const segs = Math.max(3, Math.round(o.segments));

    for (let s = 0; s < strandCount; s++) {
      const lane =
        (s - (strandCount - 1) * 0.5) * o.strandSpread +
        Math.sin(phaseOffset * 23.7 + s * 11.3) * o.strandSpread * 0.35;
      let prevX = 0;
      let prevY = 0;
      let prevZ = 0;
      // Outside loaded terrain the height query is null — carry the last known one.
      let lastGround = this.heightAt(x0, z0) ?? 0;
      for (let seg = 0; seg <= segs; seg++) {
        const t = seg / segs;
        const meander =
          (Math.sin(t * Math.PI * 2.3 + phaseOffset * 9.0) * 0.62 +
            Math.sin(t * Math.PI * 5.1 + phaseOffset * 4.3 + s * 1.7) * 0.38) *
          o.wiggle;
        const fan = Math.sin(t * Math.PI) * lane;
        const x = x0 + dx * t + px * (meander + fan);
        const z = z0 + dz * t + pz * (meander + fan);
        lastGround = this.heightAt(x, z) ?? lastGround;
        // Hover a hand's breadth over the ground so the depth test shows the
        // strand over its own terrain, while trees/rocks/hills in front still
        // occlude it. `depth` scales a small organic rise/fall on top; tendrils
        // crest a little higher at the plant foot for a rooted-mound read.
        const relief = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + phaseOffset * 5.0 + s);
        const mound = diveFromSurface ? (1 - t) * (1 - t) * 0.4 : 0;
        const y = lastGround + 0.3 + relief * Math.min(o.depth, 2) * 0.3 + mound;
        if (seg > 0) {
          positions.push(prevX, prevY, prevZ, x, y, z);
          phases.push((seg - 1) / segs + phaseOffset, t + phaseOffset);
          strengths.push(strength, strength);
        }
        prevX = x;
        prevY = y;
        prevZ = z;
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.blocks.clear();
    this.baseGeometry.dispose();
    this.glowGeometry.dispose();
    this.base.material.dispose();
    this.glow.material.dispose();
  }
}

/** Popcount of a 16-bit domain mask. */
function POPCOUNT16(v: number): number {
  let c = 0;
  let x = v;
  while (x !== 0) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Post-WFC pass: find the connected components of one block's web and bridge
 *  every smaller one to the largest with an L-shaped grid path (OR-ing connection
 *  bits along the way) — each block reads as ONE root organism. Paths never cross
 *  water; if both L-orientations would, the patch stays separate (a lake divides). */
function bridgeComponents(tiles: Uint8Array, n: number, water: Uint8Array): void {
  const cells = n * n;
  const comp = new Int32Array(cells).fill(-1);
  const members: number[][] = [];

  for (let i = 0; i < cells; i++) {
    if ((tiles[i] ?? 0) === 0 || comp[i] !== -1) continue;
    const id = members.length;
    const list: number[] = [];
    const queue = [i];
    comp[i] = id;
    while (queue.length > 0) {
      const c = queue.pop() ?? 0;
      list.push(c);
      const t = tiles[c] ?? 0;
      const gx = c % n;
      const gz = Math.floor(c / n);
      for (let d = 0; d < 4; d++) {
        if ((t & (DIR_BIT[d] ?? 0)) === 0) continue;
        const nx = gx + (DIR_DX[d] ?? 0);
        const nz = gz + (DIR_DZ[d] ?? 0);
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        if (comp[j] === -1) {
          comp[j] = id;
          queue.push(j);
        }
      }
    }
    members.push(list);
  }
  if (members.length <= 1) return;

  members.sort((a, b) => b.length - a.length);
  const main = members[0] ?? [];

  for (let m = 1; m < members.length; m++) {
    const patch = members[m] ?? [];
    // Closest cell pair patch ↔ main (grid metric).
    let bestA = patch[0] ?? 0;
    let bestB = main[0] ?? 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (const a of patch) {
      const ax = a % n;
      const az = Math.floor(a / n);
      for (const b of main) {
        const dx = (b % n) - ax;
        const dz = Math.floor(b / n) - az;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    // L-path: try x-then-z, else z-then-x — whichever stays on dry land.
    const ax = bestA % n;
    const az = Math.floor(bestA / n);
    const tx = bestB % n;
    const tz = Math.floor(bestB / n);
    const pathClear = (xFirst: boolean): boolean => {
      let cx = ax;
      let cz = az;
      const advance = (): boolean => (water[cz * n + cx] ?? 0) === 0;
      if (xFirst) {
        for (; cx !== tx; cx += Math.sign(tx - cx)) if (!advance()) return false;
        for (; cz !== tz; cz += Math.sign(tz - cz)) if (!advance()) return false;
      } else {
        for (; cz !== tz; cz += Math.sign(tz - cz)) if (!advance()) return false;
        for (; cx !== tx; cx += Math.sign(tx - cx)) if (!advance()) return false;
      }
      return advance();
    };
    const xFirst = pathClear(true) ? true : pathClear(false) ? false : null;
    if (xFirst === null) continue; // water blocks both orientations — leave apart

    let cx = ax;
    let cz = az;
    const step = (dir: number): void => {
      const i = cz * n + cx;
      const j = i + (DIR_DX[dir] ?? 0) + (DIR_DZ[dir] ?? 0) * n;
      tiles[i] = (tiles[i] ?? 0) | (DIR_BIT[dir] ?? 0);
      tiles[j] = (tiles[j] ?? 0) | (DIR_BIT[OPPOSITE[dir] ?? 0] ?? 0);
      cx += DIR_DX[dir] ?? 0;
      cz += DIR_DZ[dir] ?? 0;
    };
    if (xFirst) {
      while (cx < tx) step(1);
      while (cx > tx) step(3);
      while (cz < tz) step(2);
      while (cz > tz) step(0);
    } else {
      while (cz < tz) step(2);
      while (cz > tz) step(0);
      while (cx < tx) step(1);
      while (cx > tx) step(3);
    }
    main.push(...patch);
  }
}
