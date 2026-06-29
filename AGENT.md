# AGENT.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Vite 6 + vanilla TypeScript (no framework, no router — single page). Biome is the **only** formatter and linter (Prettier is intentionally not used). Package manager is **bun**. Dev server runs over **HTTPS by default** via `vite-plugin-mkcert`, which generates locally-trusted certs into `~/.vite-plugin-mkcert/` on first start.

## Commands

```
bun install
bun run dev        # https://localhost:5173/  (mkcert HTTPS)
bun run build      # tsc (typecheck) then vite build -> dist/
bun run preview    # serve the production build
bun run typecheck  # tsc --noEmit
bun run check      # biome check --write .  (format + lint + autofix)
bun run lint       # biome lint .   (lint only, no writes)
bun run format     # biome format --write .
```

There is no test runner yet. `bun run build` is the gate — it typechecks before bundling, so a build failure usually means a type error, not a bundling error.

## Architecture

`src/main.ts` is the single entry point (loaded by `index.html`). It wires three modules together end-to-end:

- `src/terrain-generator/` — `generateTerrain(w, h, seed)` returns a `Terrain` (a row-major `Float32Array` heightfield, values in `[0,1]`). Pure/deterministic; current noise is a placeholder. Not yet wired into the GPU scene.
- `src/renderer/` — `createRenderer()` returns a `Promise<Renderer>` owning a WebGPU `<canvas>`. See **WebGPU rendering** below.
- `src/senses/` — `createSenses(target)` is the input/perception layer; currently tracks normalized pointer position over a target element.

Data flow: `main.ts` `await`s the renderer → mounts its canvas into `#app` → starts the loop → attaches senses to the canvas. Each module is a factory returning an interface; they depend on each other only through exported types. Keep that boundary: modules talk via typed data structures, not shared globals.

Intra-`src` imports use explicit `.ts` extensions (e.g. `import ... from "./renderer/index.ts"`), enabled by `allowImportingTsExtensions`. Follow that convention in new files.

## WebGPU rendering (hard rules)

The renderer uses **three.js (r185) WebGPU + TSL**. These paradigms are non-negotiable — follow them in every new renderer/material/compute file:

- **Always import from `three/webgpu` and `three/tsl`.** `import * as THREE from "three/webgpu"` for the renderer, scene objects, and `*NodeMaterial`s; TSL node functions (`Fn`, `instancedArray`, `time`, `vec3`, …) come from `three/tsl` (they are **not** re-exported from `three/webgpu`). Never import the classic WebGL `three` entry.
- **Use TSL for all shading and compute.** Node materials (`MeshBasicNodeMaterial`, …) with TSL node graphs assigned to `.colorNode`, `.positionNode`, etc., and `Fn(() => …)().compute(n)` for compute passes. No GLSL strings, no classic (non-`Node`) materials.
- **The Rendering BufferArray is the source of truth.** The renderer exposes `renderer.buffer` — a GPU-resident storage buffer created with TSL `instancedArray(count, type)` (`RenderBuffer` type). Compute nodes *write* it, material nodes *read* it (`buffer.element(i)`), and app state lives **in** it. This extends the "modules talk via typed data structures" rule onto the GPU: work through the buffer, don't shuttle CPU arrays around. CPU readback, when needed, is `await renderer.getArrayBufferAsync(attribute)` → wrap in the matching `TypedArray`.
- **WebGPURenderer is async.** `createRenderer()` returns a `Promise` because `await renderer.init()` must run before the first frame (skip it → blank canvas, no error). The loop is `renderer.setAnimationLoop(() => { renderer.computeAsync(update); renderer.render(scene, camera); })`. `main.ts` therefore uses top-level `await`, which is why `vite.config.ts` sets `build.target: "esnext"`.
- **WebXR VR runs on the WebGPU backend.** WebGPU drives WebXR through the *same* `renderer.xr` (`XRManager`) API as the WebGL backend — no separate path. Enable with `renderer.xr.enabled = true` (before/after `init()` is fine), keep the normal `setAnimationLoop` + `render(scene, camera)` loop (three swaps in the per-eye `ArrayCamera` while presenting), and expose `VRButton.createButton(renderer)` from `three/addons/webxr/VRButton.js`. Entering a session requires **HTTPS** (already served via mkcert) and a WebXR runtime (Quest Browser, or desktop Chrome + a headset/emulator). `three/addons/*` resolves to `three/examples/jsm/*` and is typed by `@types/three`.
- **Strict TS still applies.** The TSL node graph is loosely typed; keep graphs shallow so no `as`/`any` is needed (both are banned). If a cast ever seems unavoidable, wrap it in one typed helper rather than weakening the gates.

## Strict pass rules

Both gates must pass clean — no errors, no warnings, no suppressions — before code is considered done. Run `bun run typecheck && bun run check`.

### TypeScript (`tsconfig.json`)

Beyond `strict: true`, these are enabled and must be satisfied without escape hatches:

- **No `any`** — neither implicit (`strict`/`noImplicitAny`) nor explicit (banned by Biome below). Use `unknown` + narrowing when a type is genuinely open.
- `noUncheckedIndexedAccess` — indexed reads (`arr[i]`, index signatures) are `T | undefined`. Handle the `undefined`: iterate with `for...of` / `.entries()`, or narrow/default explicitly. Do **not** reach for `!` to silence it.
- `exactOptionalPropertyTypes` — `{ x?: T }` is not assignable from `{ x: undefined }`; omit the key instead of passing `undefined`.
- `noPropertyAccessFromIndexSignature` — access index-signature members with `obj["key"]`, reserve dot access for declared properties.
- `noImplicitReturns`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports` — all on.

Do not weaken these to make code compile, and do not paper over them with `!`, `as`, or `// @ts-ignore`. Fix the underlying type instead. If a cast is truly unavoidable, prefer a typed guard/helper (see `require2dContext` in `src/renderer/index.ts`) over an assertion.

### Biome (`biome.json`)

Formatter + linter, recommended ruleset, with these promoted to **error**:

- `suspicious/noExplicitAny` — explicit `any` is forbidden (this is what enforces "no `any`" on the lint side).
- `suspicious/noImplicitAnyLet` — no untyped, uninitialized `let`.
- `complexity/noBannedTypes`.

Note: Biome's recommended set also bans non-null assertions (`style/noNonNullAssertion`), which is why `!` is not an available workaround for the TS index/null rules above — the two gates are aligned by design.

Formatting is fixed by config (2-space indent, 100 col, double quotes, semicolons, trailing commas) — let `bun run check` apply it rather than formatting by hand.
