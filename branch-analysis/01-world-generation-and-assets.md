# World generation & assets — branch vs `main`

This is the topic the review was asked to focus on: **did the vibe coding change
world generation and assets, or is the branch stale here?**

## Short answer

The branch **changed world *rendering* substantially** but **did not receive any of
`main`'s world *population* work**. The two branches touched overlapping files
(`water-material.ts`, `world.ts`) in *divergent* commits, so this is a genuine fork,
not a fast-forward. There are **no binary assets** in the repo on either side — the
world is 100% procedural.

## Assets: there are none (by design)

A scan for `.glb/.gltf/.png/.jpg/.hdr/.exr/.mp3/.wav/.ogg` under `src/` returns
nothing on either branch. The only non-code data files are:

- `src/theatre/state.json` — the authored Theatre timeline (grew +272 lines on the
  branch: it now carries the nine per-sense envelopes; see the architecture doc).
- config: `package.json`, `biome.json`, `tsconfig.json`, `bun.lock`.

Everything visible is generated at runtime: terrain from worker-side noise/WFC
(`src/terrain/gen/**`), creatures from boids (`src/creatures/`), flora scattered
procedurally (`src/life/`, main only), scent as a GPU particle field, etc. The
MASTERPLAN is explicit: *"kein GLB im Repo"* (no GLB in the repo) — bird wings and
mushrooms are procedural. **So "assets" = generation code, and that code diverged.**

## What the branch CHANGED in world generation/rendering

The headline change is a **paradigm shift in how the terrain is shaded**, driven by
the "white void is load-bearing" design rule (AGENT.md):

### 1. Terrain became UNLIT — revealed only by senses
`src/terrain/world.ts`:
- The terrain material changed from `MeshStandardNodeMaterial` (PBR, lit) to
  `MeshBasicNodeMaterial` (**unlit**).
- The scene lights (hemisphere + directional "sun") that used to live in the world
  were **removed entirely**. Lighting is now a lambert term folded into the `farben`
  sense layer, so with no sense active the world is an invisible uniform white field.
- The terrain and water materials now compose a **sense-layer compositor**
  (`opts.layers` → `TerrainLayerCompositor`) over the biome albedo, with a
  `rewire()` path so a structural sense change (blend mode / layer order) rebuilds
  the material's `colorNode` in place (`onStructureChange`).

### 2. Live GenParams overlay from the dev GUI
`TerrainWorld` gained `setParams()` / `resetParams()` / `config` / `paramOverrides`
so the new `src/dev-console/world-controls.ts` can retune the generator live and
rebuild streamed chunks in place.

### 3. Water material
`src/terrain/render/water-material.ts` (+100 lines) now returns a
`WaterMaterialHandle` with the same `rewire()` compositor hook as terrain, so water
also carries the sense layers.

### Files the branch touched in `src/terrain/`
`chunk.ts` (+4), `index.ts` (+5), `render/terrain-material.ts` (+142),
`render/uniforms.ts` (+2), `render/water-material.ts` (+100), `world.ts` (+77).

## What the branch is MISSING (lives only on `main`)

`main`'s 8 post-divergence commits are almost entirely world-population work, and
**none of it is on this branch**:

| `main` commit | What it adds | On this branch? |
|---|---|---|
| `8b41f59` Fill the world with instanced flora wired to the signal substrate | `src/life/` (assets/instancing/scatter/species/proximity) | ❌ absent |
| `5d71d57` Raise flora density | flora tuning | ❌ |
| `d745cea` Pack flora instances: draw only what exists | instancing perf | ❌ |
| `57b6f0d` Add stationary dust motes so motion reads as parallax | `src/atmosphere/` (dust motes) | ❌ absent |
| `0679646` Fix lake rendering: trench, shoreline, water extent | `water-material.ts` fix | ❌ (branch has its *own* divergent water-material) |
| `94a22aa` Hide the river water ribbons | hydrology render | ❌ |
| `4a4c2a1` force WebGPU Renderer / `cf78f5e` stop forcing WebGL | renderer backend | ❌ |

`main`-only directories confirming this: `src/atmosphere/` (dust.ts, material.ts,
uniforms.ts, index.ts), `src/life/` (assets, instancing, matrix, proximity,
scatter, species, material, uniforms), `src/render/` (tsl-kit.ts, uniforms.ts).

### Critical: the overlap conflict
Both branches edited `src/terrain/render/water-material.ts` in *different* commits
(branch: `3427e22`; main: `8b41f59`). A merge will **conflict** on the water
material, and the conflict is semantic: the branch rewrote it around the sense
compositor, while `main` fixed lake geometry. Neither is a clean superset.

## The "life"/"atmosphere" wiring is against the OLD sense model

`main`'s `life` and `atmosphere` modules share `senses.uniforms` from the *old*
single-mode `createSenses({ start: "normal" })`. The branch deleted that model and
replaced it with the nine-layer system (see architecture doc). So flora/dust cannot
simply be dropped onto the branch — they'd have to be **re-wired to the new sense
signals and the new unlit terrain paradigm** (a lit-flora world contradicts the
"white void" rule the branch's terrain now enforces).

## Legacy note
`src/terrain-generator/index.ts` (the old placeholder `generateTerrain(w,h,seed)`
described in AGENT.md as "not yet wired into the GPU scene") is **deleted in the
working tree** (uncommitted `D` on this branch). The live world is
`src/terrain/` (chunked/streamed), not `terrain-generator/`. Worth committing the
deletion or restoring it deliberately.

## Verdict on the focus question
The branch is **actively developed, not stale**, in world rendering — but it forked
*away* from `main`'s world-population line. Re-uniting them means porting `main`'s
flora + dust + lake/river fixes onto the branch's unlit, layered-sense terrain, not
a fast-forward.
