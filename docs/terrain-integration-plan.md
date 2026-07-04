# Terrain & World Generation Integration Plan

**Target:** `becoming-many` (Vite 6 + vanilla TS + three.js r185 **WebGPU/TSL**, bun, HTTPS, WebXR).
**Source of ideas:** `neural-flight-template/src/lib/experiences/becoming-many/terrain` (~5.1k LOC, already `three/webgpu` + `three/tsl`).

Goal: a **chunk-based, worker-driven, WebGPU-rendered infinite world** whose structure is planned by **two Wave Function Collapse passes** — one for **biomes** (adjacency rules between biome types) and one for **height** (per-biome landform rules) — synthesized into seamless heightfield chunks and streamed around the flying player.

---

## 0. TL;DR — the shape of the thing

```
                      ┌──────────────────────────  MAIN THREAD  ──────────────────────────┐
 player (x,z) ──►  TerrainWorld.update ──► ChunkScheduler ──► build(gx,gz) ─┐              │
                                                                            │              │
                                                            ┌───────────────▼────────────┐ │
                                                            │      WorldgenClient         │ │  ← promise/id transport
                                                            └───────────────┬────────────┘ │
                                                                            │ postMessage    │
        ┌───────────────────────────────  WEB WORKER  ─────────────────────▼──────────────┐│
        │  WorldMapGenerator.generateChunk(gx,gz,params)                                   ││
        │   ├─ RegionManager (LRU) ── MacroWorldGenerator(region)                          ││
        │   │        ├─ PASS A: Biome-WFC   (WfcSolver + biome tiles/rules)   ← existing   ││
        │   │        ├─ PASS B: Height-WFC  (WfcSolver + per-biome landform)  ← NEW        ││
        │   │        └─ hydrology (rivers/lakes/flow)                          ← existing  ││
        │   ├─ fields.ts continuous noise (seamless f(worldXY,seed))                       ││
        │   ├─ height synthesis: WFC landform grid ⊕ per-tile noise ⊕ hydrology carving    ││
        │   └─ mesh: TerrainSampler → buildChunkArrays → {positions,normals,biome,height}  ││
        └──────────────────────────────────────────────────────┬──────────────────────────┘│
                                                                │ transfer ArrayBuffers      │
                       ┌────────────────────────────────────────▼─────────────────────────┐ │
                       │ TerrainChunk: BufferGeometry(+shared index) + TSL NodeMaterial     │ │
                       │  → scene.add(mesh); ChunkHeightCache.add(heightGrid)               │ │
                       └────────────────────────────────────────────────────────────────────┘ │
                                                                                               │
                       ChunkHeightCache.sample(x,z) ──► flight floor / decoration placement   │
                       └───────────────────────────────────────────────────────────────────────┘
```

Everything left of "mesh" is **pure CPU TypeScript, zero three.js/DOM** and runs in the worker. Everything from "mesh" rightward is main-thread `three/webgpu` + `three/tsl`.

---

## 1. Key findings from the reference (read before you build)

1. **It is already WebGPU/TSL.** Every render file imports `three/webgpu` + `three/tsl`, materials are `Mesh*NodeMaterial` with `colorNode`/`emissiveNode` TSL graphs. The render layer is a **lift-and-shift**, not a port. It already obeys the same hard rules as `AGENT.md`.

2. **WFC scope in the reference is biome/structure only** — 13 *attribute* macro tiles (`Ocean, Coast, Lowland, Grassland, Forest, Wetland, Desert, Hills, RockyMountain, SnowMountain, LakeCandidate, RiverSource, RiverCorridor`), one tile per **32 px macro cell**, adjacency via a hand-authored symmetric whitelist compiled to a **bitmask** (`COMPAT_MASK`, ≤32 tiles).

3. **`WfcSolver` is generic and reusable.** Its input is `{w,h, priors:Float32Array, pinned:Int16Array, rng, maxRestarts}` and it returns a `Uint8Array` of tile ids. It is bitmask domains + min-entropy observe + AC-3 von-Neumann propagate + restart-on-contradiction + argmax fallback. **Nothing in it is biome-specific** — a second pass for height only needs a different tile set + constraint table + priors.

4. **Height is currently analytic noise, not WFC** (`fields.ts`: domain-warp → continent fbm → land mask → ridged mountains; climate + lapse; moisture). Per-pixel biome is *threshold classification* of continuous fields, **not** WFC output. `WfcTile.noiseProfile` (`flat|rolling|dunes|ridged|fbm`) exists but is **never consumed** — a ready-made hook for our height layer.

5. **Seamlessness is a discipline, not a fix-up.** Two rules make chunks tile without cracks:
   - *Everything continuous is a pure function of world position + seed* (per-seed variation is a **coordinate offset only**, `seedToOffset`, never reseeding).
   - *Everything discrete (WFC) runs at REGION granularity with the border ring deterministically pinned* to `argmaxTile(fields)`, so neighbouring regions agree on the shared seam. Region results are LRU-cached.
   - Meshing reads a **1px-bordered height map** + an apron of true-neighbour heights so shared vertices/normals are identical across chunks.

6. **Generation is worker-CPU by necessity in the reference** (a Worker has no WebGPU device, so the original TSL gradient-noise was re-implemented as CPU value-noise — an accepted visual trade). We keep the worker-CPU pipeline for v1 (it's proven and portable); a later phase can move the *continuous* noise back to GPU compute.

7. **Coordinate tiers** (defaults): world px → **chunk 256 px** (`terrainSegments 40` → 41×41 verts) → **macro cell 32 px** → **region 32×32 macro = 1024 px**. Streaming: `buildRadius 2`, `keepRadius 3`, `maxBuildsPerFrame 1`, **no LOD** (uniform resolution).

8. **DOM/GUI coupling to drop or re-skin:** `lil-gui` (`worldgen-gui.ts`), Canvas2D `minimap.ts`, and a `StreamingConfig` imported from a sibling experience. None are core; re-implement behind our own tiny debug UI or omit for v1.

---

## 2. The two WFC passes (the heart of the request)

### Pass A — Biome WFC (port, largely as-is)

- **Reuse** `WfcSolver`, `WfcTile`, `biomeTiles`, `constraints`, `tilePriors`/`argmaxTile`, `MacroWorldGenerator`.
- Runs per region on a 32×32 macro grid. Priors from `bandScore` over `(height, temp, moisture)` sampled from `fields.ts`; border ring pinned to `argmaxTile`; RNG `mulberry32(deriveSeed(seed,rx,ry,0x5fc))`.
- Output: `macroTiles: Uint8Array(32*32)` per region → per-pixel `macroMap` by stamping. This drives biome intent + river-source hints.
- *Optional enhancement:* also derive the per-pixel `Biome` from the macro tile (instead of pure threshold classification) so biome regions read as WFC-authored blocks with soft edges. Keep threshold classification as the fallback/refinement inside a tile.

### Pass B — Height WFC (NEW — the extension you asked for)

**Idea:** within the landform planned by Pass A, run a *second* WFC over a grid of **landform archetype tiles**, where the **tile set and adjacency rules are chosen per biome**. Then synthesize a continuous, seamless heightfield from that discrete layout.

**Resolution:** a "meso" grid finer than macro — e.g. subdivide each 32 px macro cell into `m×m` height-tiles (start `m=2` → 16 px height-tiles; tune). Still region-scoped and border-pinned for seamlessness.

**Per-biome landform tile sets** (`heightTiles.ts`) — each tile carries `{ id, elevationBand:[lo,hi], noiseProfile, weight }`; adjacency is a per-biome symmetric whitelist compiled to a bitmask exactly like Pass A. Sketch:

| Biome | Landform tiles | Rule flavour |
|---|---|---|
| RockyMountain / Snow | `peak, high-ridge, ridge, saddle, upper-slope, cliff, valley-floor` | peaks only touch ridges; cliffs bridge slope↔valley; valley-floors chain into drainage |
| Hills | `crest, upper-slope, slope, hollow, flat` | crests isolated by slopes; hollows collect |
| Grassland / Lowland | `flat, gentle-rise, gentle-dip` | mostly flat, rare rises |
| Desert | `dune-crest, dune-windward, dune-lee, interdune` | **directional** rules (windward↔crest↔lee ordering) → barchan-like dunes |
| Wetland | `flat, hummock, channel` | channels chain; hummocks scattered |
| Coast / Beach | `shore-shelf, berm, backshore` | monotonic shelf→berm→backshore |
| Ocean | `shelf, slope, deep` | depth-monotonic |

**Priors** for Pass B are conditioned on Pass A's biome at that cell **and** the continuous `fields.ts` sample (so tiles still track real elevation/slope). Border ring pinned to the argmax landform tile of that conditioned prior → seam agreement.

**Continuous height synthesis** (`HeightSynthesizer.ts`), all seamless `f(worldXY, seed)`:
1. **Target elevation surface** = smooth (bicubic) interpolation of each tile's elevation-band midpoint across the meso grid → a coherent macro relief that *obeys the WFC layout* (peaks where peak-tiles landed, dune ridges where crest-tiles chained, etc.).
2. **Per-tile detail** = the tile's `noiseProfile` (`flat/rolling/dunes/ridged/fbm`) evaluated as pure world-space noise, blended by tile-membership weights (`bandScore`-style soft masks) so profiles cross-fade instead of stepping.
3. **⊕ hydrology** — river valley carving + lake-basin clamp + shore flattening (port `WaterDistanceMapGenerator`, `rivers/*`, `lakes/*`).
4. Feed the result through `heightToWorldY(heightNorm, params)` (shared by terrain + water so surfaces align).

**Why this stays crack-free:** Pass B uses the identical region+pinning+bordered-map discipline as Pass A and `fields.ts`. The only new seam surface is the meso-tile grid, handled by the same border-pin trick.

> **Design note / decision point:** Pass B is *additive over* the existing noise relief, not a replacement. Two dials to expose: `heightWfcStrength` (0 = pure `fields.ts` noise, as reference; 1 = WFC layout dominates) and `mesoSubdiv` (`m`). Start at `strength≈0.6, m=2` and tune. This lets you A/B the WFC-height look against the proven noise baseline without a rewrite.

---

## 3. Target module layout (one big, modular module)

Supersede the placeholder `src/terrain-generator/`. New tree under `src/terrain/`:

```
src/terrain/
  index.ts                     # public facade: createTerrainWorld(opts) → TerrainWorld
  world.ts                     # TerrainWorld orchestrator (streaming, provider wiring)
  chunk.ts                     # TerrainChunk: typed arrays → BufferGeometry + material
  scheduler.ts                 # ChunkScheduler<T> (anchor/build/keep radii, hysteresis)
  height-cache.ts              # ChunkHeightCache (flight floor / placement sampling)
  coords.ts                    # world/chunk/macro/region coordinate helpers + keys

  render/
    terrain-material.ts        # createTerrainMaterial(uniforms, uTime) — TSL NodeMaterial
    water-material.ts          # createWaterMaterial(...)
    uniforms.ts                # createSenseUniforms() + KitUniforms type (senses → shading)
    decorations.ts             # DecorationSet (instanced rocks/grass) — optional v1.5

  gen/                         # PURE CPU — no three, no DOM. Worker-safe.
    params.ts                  # GenParams, DEFAULT_PARAMS, configToParams(TerrainConfig)
    rng.ts                     # mulberry32, hash2D, deriveSeed, seedToOffset
    noise.ts                   # valueNoise2D, fbm2D, signedFbm2D
    fields.ts                  # baseHeight01/fineHeight01/temperature01/baseMoisture01
    wfc/
      WfcSolver.ts             # GENERIC solver (shared by both passes)
      WfcTile.ts               # tile/band types + bandScore
      biomeTiles.ts            # Pass A tile set
      biomeConstraints.ts      # Pass A adjacency + tilePriors/argmaxTile
      heightTiles.ts           # Pass B per-biome landform tile sets            ← NEW
      heightConstraints.ts     # Pass B per-biome adjacency + conditioned priors ← NEW
    world/
      WorldCoords.ts
      RegionManager.ts         # LRU, stores { macroTiles, landformTiles, hydrology }
      MacroWorldGenerator.ts   # runs Pass A + Pass B + hydrology per region
      WorldMapGenerator.ts     # per-chunk assembly (samples regions, synthesizes)
    height/
      HeightSynthesizer.ts     # WFC landform grid → continuous seamless height   ← NEW
      BiomeTerrainProfiles.ts  # computeMasks + BiomeProfile (color/veg)
      TerrainSampler.ts        # ChunkData → sample* bridge for meshing
      TerrainDetailGenerator.ts# final per-vertex height/normal composition
      TerrainNormalBuilder.ts  # analytic normals from extended grid
      mesh.ts                  # buildChunkArrays → ChunkVertexData
    hydrology/
      SlopeMapGenerator.ts  WaterDistanceMapGenerator.ts
      rivers/*  lakes/*  fields helpers
    water/
      water-mesh.ts  shoreline.ts

  worker/
    worldgen.worker.ts         # single stateful worker (warm region LRU)
    worldgen-client.ts         # promise/id transport (main thread)
    worldgen-protocol.ts       # request/result message types
    pool.ts + protocol.ts + terrain.worker.ts   # (optional) pointwise providers

  providers/
    provider.ts registry.ts index.ts
    worldgen.ts                # thin shell provider (kind:"chunk")
    (ridged.ts sine-hills.ts)  # optional debug providers

  debug/
    worldgen-gui.ts minimap.ts # optional; re-skin off lil-gui or drop for v1
```

**Modularity contract (mirrors `AGENT.md`):** every subfolder talks to the rest **only through exported types** (`ChunkData`, `ChunkVertexData`, `GenParams`, `TerrainConfig`, protocol messages). `gen/**` must never import `three` or touch DOM — enforce with a lint/CI grep. The render layer never imports `gen/**` internals, only the typed-array results crossing the worker boundary.

---

## 4. Integration with the existing app

- **`main.ts`**: after `createRenderer()`, `const world = createTerrainWorld({ scene: renderer.scene, ... })`. In the frame loop add `world.update(rig.position.x, rig.position.z)` using the player rig's world XZ. Everything else (ICAROS, keyboard, VR) is untouched.
- **Flight floor (optional):** expose `world.sampleHeight(x,z)`; either keep free flight (it's a flight sim) or softly clamp the rig above terrain. Recommend: keep free flight, expose the sampler for decorations + an optional "don't fly through mountains" assist.
- **Senses → shading:** the reference materials fade/reveal by camera distance + a "sense" uniform set. Wire `src/senses` into `render/uniforms.ts` so pointer/attention modulates the look (nice-to-have; v1 can use static uniforms).
- **Rendering BufferArray:** terrain doesn't need the existing `renderer.buffer`; leave it as-is. The `AGENT.md` TSL rules still bind all new materials (no GLSL, `three/webgpu` + `three/tsl` only, strict TS, no `any`/`!`/`as`).
- **Vite workers:** standardize on `new Worker(new URL("./worldgen.worker.ts", import.meta.url), { type: "module" })` (framework-agnostic; the reference's `?worker` suffix is SvelteKit-flavoured). Add `"WebWorker"` to `tsconfig` `lib` so worker globals type cleanly and the `self as unknown as Worker` cast can go. Keep `build.target: esnext`.

---

## 5. Phased implementation plan

Each phase is independently shippable and visible on screen.

### Phase 1 — Render + streaming skeleton (no WFC yet)
Port `coords`, `scheduler`, `chunk`, `world`, `height-cache`, `render/*`, provider abstraction, and the **worker transport** with a *trivial* pointwise provider (port `ridged.ts`). Wire `world.update` into `main.ts`.
**Exit:** flying over a streamed, chunked ridged-noise terrain in WebGPU + VR, chunks load/unload around the player, no cracks, stable FPS. This de-risks all the plumbing before any generation complexity.

### Phase 2 — Continuous field generation in the worker
Port `gen/params`, `rng`, `noise`, `fields`, `WorldCoords`, `RegionManager` (LRU), `TerrainSampler`, `TerrainDetailGenerator`, `TerrainNormalBuilder`, `mesh`, `SlopeMapGenerator`, `WaterDistanceMapGenerator`, and the `worldgen` chunk provider + `worldgen.worker` + client/protocol.
**Exit:** the `worldgen` provider renders seamless noise terrain with slope/water-distance fields; `ChunkHeightCache` drives the flight floor. No WFC yet — this is the reference's baseline reproduced.

### Phase 3 — Pass A: Biome WFC
Port `WfcSolver`, `WfcTile`, `biomeTiles`, `biomeConstraints`, `MacroWorldGenerator` (Pass A only), `BiomeGenerator`/classification, `BiomeTerrainProfiles`. Stamp macro tiles into `ChunkData`; color terrain/decorations by biome; port the minimap (re-skinned) to visualize biome layout.
**Exit:** biomes are laid out by WFC with legal adjacencies, visible on the terrain and minimap; height still noise-based.

### Phase 4 — Pass B: Height WFC (the new layer)
Add `heightTiles.ts`, `heightConstraints.ts`, `HeightSynthesizer.ts`; extend `MacroWorldGenerator` to run Pass B (conditioned on Pass A) and `RegionManager` to cache the landform grid; blend synthesized height into `TerrainDetailGenerator` behind `heightWfcStrength`. Add per-biome landform rule tables (start with mountains + desert + hills, expand).
**Exit:** terrain relief is authored by per-biome landform WFC — mountain ridge-lines, dune fields, hill crests read as *rule-driven* structure, seamless across chunks, tunable against the noise baseline.

### Phase 5 — Hydrology + water rendering
Port `rivers/*`, `lakes/*`, `water/water-mesh`, `shoreline`, `water-material`; wire river-source hints from Pass A and valley carving into the synthesizer.
**Exit:** rivers/lakes carve terrain and render with the water material.

### Phase 6 — Polish & tuning
Decorations, debug GUI (re-skinned), senses→uniforms, parameter tuning, and (optional) moving continuous noise to GPU compute for perf. Performance pass: `maxBuildsPerFrame`, region LRU size, transferable audit.

---

## 6. Risks, decisions, and how they're handled

| # | Risk / decision | Resolution |
|---|---|---|
| R1 | **Height-WFC seams** — a discrete grid tends to crack across chunks/regions. | Reuse the region + border-pin + bordered-map discipline verbatim; Pass B is region-scoped with argmax-pinned borders. Validate with a seam-diff test between adjacent chunks. |
| R2 | **Height-WFC looks blocky.** | Synthesis interpolates tile elevations (bicubic) and cross-fades noise profiles; `heightWfcStrength` blends against noise baseline. Meso subdivision `m` trades coherence vs. detail. |
| R3 | **Two WFC passes cost CPU per region.** | Region-scoped + LRU-cached (64 regions); a region covers up to 4 chunks and is computed once. Single stateful worker keeps the cache warm. Profile in Phase 4; raise region cache or lower meso res if needed. |
| R4 | **Worker CPU noise ≠ GPU look** (value vs gradient noise). | Accept for v1 (proven). Phase 6 optionally restores TSL gradient noise on GPU for the *continuous* layer; the WFC layout stays CPU (needs sequential RNG + adjacency, not GPU-friendly). |
| R5 | **>32 landform+biome tiles** breaks the bitmask domain. | Pass A (13) and Pass B (per-biome, ≤~8 each) stay well under 32 *per pass*. Keep passes separate; never merge tile spaces. |
| R6 | **Strict TS gates** (`noUncheckedIndexedAccess`, no `any`/`!`/`as`). | The reference is already `three/webgpu`; typed-array access needs explicit `undefined` handling — port with `for...of`/`.entries()` and typed guards, not `!`. Budget time for this in every phase. |
| R7 | **DOM/GUI coupling** (`lil-gui`, Canvas2D minimap, sibling `StreamingConfig`). | Relocate `StreamingConfig` into `world.ts`; gate/re-skin GUI + minimap behind `debug/`; both are optional and XR-hidden. |
| R8 | **Free-flight vs. terrain collision.** | Keep free flight (flight sim); expose `sampleHeight` for placement + optional soft floor assist. Decide in Phase 2. |

---

## 7. Concrete first step

Start Phase 1 by porting the pure-plumbing files in this order (each compiles green under strict TS before the next): `coords.ts` → `provider.ts`/`registry.ts` → `scheduler.ts` → `height-cache.ts` → `render/uniforms.ts` + `render/terrain-material.ts` → `chunk.ts` → `worker/*` with the ridged provider → `world.ts` + `index.ts` → wire into `main.ts`. Ship the flying-over-ridges milestone, then move to Phase 2.

---

## 8. Confirmed design decisions

Locked in with the user (2026-07-04):

1. **Height WFC augments noise, tunable.** Pass B blends *over* the proven seamless noise relief via `heightWfcStrength` (0 = pure noise baseline, 1 = WFC layout dominant). Start ~0.6. This keeps a working fallback and lets us A/B the WFC look against the baseline — lowest risk. **Not** a full replacement of noise.
2. **Per-pixel biome comes from Pass A WFC tiles.** Biomes render as WFC-authored blocks with soft edges; threshold classification only *refines within* a tile. Matches the "WFC for biomes" intent and reads more coherent than pure field thresholding.
3. **Continuous noise stays worker-CPU for v1.** Keep the proven CPU value-noise in the worker (WFC needs CPU anyway, and CPU `heightGrid` readback feeds the flight floor for free). GPU-compute noise is revisited only in Phase 6 if perf/look demands it.

*Still to tune during implementation (not blocking):* `heightWfcStrength` default, meso subdivision `m` (start 2), and per-biome landform rule tables (start mountains + desert + hills, expand).
