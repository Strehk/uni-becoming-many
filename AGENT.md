# AGENT.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Vite 6 + vanilla TypeScript (no framework, no router — single page). Rendering is three.js (r185) WebGPU + TSL (see below). Biome is the **only** formatter and linter (Prettier is intentionally not used). Package manager is **bun**. Dev server runs over **HTTPS by default** via `vite-plugin-mkcert`, which generates locally-trusted certs into `~/.vite-plugin-mkcert/` on first start.

## Commands

```
bun install
bun run dev        # https://localhost:5173/  (mkcert HTTPS, LAN-exposed via --host)
                   #   also starts the M5 bridge in-process: browser stream on the same
                   #   origin at /ws/m5, device listener on plain :5184 (bridge/vite-plugin.ts)
bun run build      # tsc (typecheck) then vite build -> dist/
bun run preview    # serve the production build (static only, no bridge)
bun run serve      # production entry: dist/ + both bridge sockets (bridge/serve.ts)
bun test           # bun's own runner; covers src/m5/pipeline/
bun run typecheck  # tsc --noEmit
bun run check      # biome check --write .  (format + lint + autofix)
bun run lint       # biome lint .   (lint only, no writes)
bun run format     # biome format --write .
```

`bun run build` is the gate — it typechecks before bundling, so a build failure usually means a type error, not a bundling error. `bun test` covers `src/m5/pipeline/` only: those are pure functions whose constants are tuned to the physical flight rig, ported from the ICAROS host together with its tests. The rest of the codebase has no tests.

## Architecture

`src/main.ts` is the single entry point (loaded by `index.html`). It wires three modules together end-to-end:

- `src/terrain-generator/` — `generateTerrain(w, h, seed)` returns a `Terrain` (a row-major `Float32Array` heightfield, values in `[0,1]`). Pure/deterministic; current noise is a placeholder. Not yet wired into the GPU scene.
- `src/renderer/` — `createRenderer()` returns a `Promise<Renderer>` owning a WebGPU `<canvas>`. Exposes `scene` and `camera` (add world objects / rigs to `scene`), a TSL grid floor as a spatial reference, and `start(onFrame?)` — the loop calls `onFrame(dtSeconds)` before each compute+render. Status/debug HUD is the three.js WebGPU `Inspector` (`three/addons/inspector/Inspector.js`) — Performance (GPU frame timing via the renderer's `trackTimestamp`), Console, Parameters, Viewer tabs. It's assigned to `renderer.inspector` **before** `renderer.init()` and self-mounts next to the canvas with its own toggle button. See **WebGPU rendering** below.
- `src/senses/` — `createSenses(target)` is the input/perception layer; currently tracks normalized pointer position over a target element.
- `src/player/` — `createPlayer(camera, options)` is locomotion: it reparents the camera into a rig `Group` and flies forward at a constant `speed`, steered by a normalized `{ pitch, roll }` input via `update(dtSeconds, input)`. Move the **rig**, not the camera — in VR the headset writes the camera's pose within the rig, so flying the rig composes with head tracking. Add `player.rig` to `renderer.scene`.
- `src/m5/` — the controller. `createController()` returns a `Controller` whose `input` (pitch/roll/quality/button) is mutated in place for the frame loop to read, plus `calibrate()` / `setAxisField()` and a `dispose()`. It connects to `/ws/m5` on **this page's own origin** and reconnects with backoff. `src/m5/protocol.ts` holds both wire formats and their guards (external data stays `unknown` until checked); `src/m5/pipeline/` is the pure control pipeline shared with the bridge.
- `bridge/` — the server half, and the reason this repo no longer needs an external ICAROS host. The M5 firmware is a WebSocket *client* that speaks plain `ws://` only, so a browser can neither listen for it nor reach it from an HTTPS page. `createBridge()` owns a device socket (`ws://:5184/ws/device`, pairing-token authenticated) and a browser socket (`/ws/m5`, read-only for control, tuning commands back). Both `attach*` functions take a `node:http.Server`, so `bridge/vite-plugin.ts` (dev) and `bridge/serve.ts` (production) share one implementation. Pipeline order is load-bearing: **normalize → axis-map → calibrate → safety → auto-neutralize → smooth**. See `docs/m5-bridge.md`.

Data flow: `main.ts` `await`s the renderer → mounts its canvas into `#app` → creates the player and adds `player.rig` to `renderer.scene` → attaches senses to the canvas → `createController()` → `renderer.start(onFrame)` where each frame reads `controller.input` to steer the player (`player.update(dt, …)`) and publishes `controller.input.quality` onto `signals.controlQuality`. That closes the loop: M5 → bridge → `controller.input` → player rig → camera. Teardowns run on `pagehide`.

There is **nothing to configure** for that connection: the stream rides this page's own origin, so a headset trusts one certificate instead of two, and `?host=` / `VITE_ICAROS_HOST` / `scripts/start.ts` are gone. Run `bun run dev` (`vite --host`) to expose a headset-reachable LAN address. Each module is a factory/entry function returning an interface or teardown; they depend on each other only through exported types. Keep that boundary: modules talk via typed data structures, not shared globals.

There are three page entry points, all listed in `vite.config.ts`: `index.html` (the experience), `synth.html` (the vendored Tone.js synth), and `pair.html` (`src/pair/`, the Web Serial page that writes WiFi + bridge URL onto the M5 over USB).

**`bun run dev` runs Vite under Node, not Bun.** `bun run` honours the `#!/usr/bin/env node` shebang on `node_modules/.bin/vite`, so `Bun.*` APIs are unavailable inside a Vite plugin — that is why `bridge/` is written against `node:http` + the `ws` package rather than `Bun.serve`, and why `ws` is a runtime dependency. Code under `bridge/` must run on both runtimes: Node in dev, Bun in the production container.

Intra-`src` imports use explicit `.ts` extensions (e.g. `import ... from "./renderer/index.ts"`), enabled by `allowImportingTsExtensions`. Follow that convention in new files.

## Sense layers & module integration

Since the module integration (see **docs/MASTERPLAN.md** — the authoritative integration plan/status), the senses are **layers, not exclusive modes**: nine `SenseId`s (`src/senses/ids.ts`), each with an intensity signal `signals.sense[id]` (0..1), any combination active at once. Control flow:

- **Commands into modules go over the bus** — `sense:set/toggle/solo/clear` (activation, handled by the `SenseDirector`), `sense:param {id,key,value}` (module parameters), `sense:blend`/`sense:move` (structural shader-layer changes). Keys **1–9** toggle layers, **0** clears; the dev-console sense panel (`src/dev-console/sense-controls.ts`) emits the same commands and renders module parameters from UI-agnostic descriptors.
- **Theatre and manual control write the same signals**, gated by `signals.senseAuthority` (`"manual" | "theatre"`): the Timeline sheet's `arc.senses` compound (one 0..1 envelope per sense, ~300 s sequence) is pumped into `signals.sense[id]` only in theatre mode; any manual bus command flips authority to manual. Flight recording/playback is deliberately gone — the flight is player-controlled only.
- **Sense modules** live under `src/senses/<id>/` and each couples the same way: subscribe to its signal (eased fade), read the spine time from `signals.time`, take `sense:param` from the bus, cost nothing while faded out. `shader/` (farben/echo/infrarot/uv — composited into the terrain material via the `layers` option), `magnetfeld/` (sky dome), `duft/` (GPU scent field, re-anchoring), `netzwerk/` (swarm web + mycelium, fed by `src/creatures/`), `motion/` (vertex-motion trails, hides the bird meshes), `rundum/` (little-planet view via `renderer.setRenderOverride`).
- `src/creatures/` is the host actor substrate (boids birds + mushroom spawns) that netzwerk/motion perceive; it emits `creatures:mushrooms-changed` on re-scatter.
- **The white void is load-bearing.** With no sense active the world must be *invisible* — a uniform pale field, no terrain form, no creatures. This drives three rules: (1) the terrain + water materials are **unlit** (`MeshBasicNodeMaterial`) — lighting is a lambert term folded into the `farben` layer's `light`, never scene lights, so a white albedo can't betray form through shading; (2) a master `worldReveal` uniform (0 = void, eased to 1 by the SenseManager whenever the dominant sense ≠ "none") gates both materials to the void `fogColor`; (3) `renderer.scene.background` tracks the live `fogColor`, so the empty sky matches the colour the world dissolves into. The startup default is **no sense** (`createSenses(bus)` seeds `[]`). Adding an always-on visible object to the base scene breaks this — gate new world objects on a sense signal.
- **The synth is the one vendored exception**: `src/synth/vendor/` is the designers' Tone.js app (UI/UX intentionally untouched, Tone pinned to 14.8.49, ignored by Biome, plain JS invisible to tsc). It runs on its own page `synth.html` — standalone on a phone or as the in-app iframe overlay (key **M**, host bridge `src/synth/index.ts` pushes `window.__bmFrame` with pose/flight/sense sources each frame and auto-adds mapped synth layers on a sense's first rise). The only vendor edits: the demo flight world/card were replaced by a signal-source card, `mapping.js` gained `SENSE_QUELLEN`, and `app.js` mixes `__bmFrame.senses` into the live sources.

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
