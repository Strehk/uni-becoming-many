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

- `src/terrain-generator/` — `generateTerrain(w, h, seed)` returns a `Terrain` (a row-major `Float32Array` heightfield, values in `[0,1]`). Pure/deterministic; current noise is a placeholder.
- `src/renderer/` — `createRenderer(scale)` returns a `Renderer` owning its own `<canvas>`; `render(terrain)` paints the heightfield as a grayscale `ImageData`.
- `src/senses/` — `createSenses(target)` is the input/perception layer; currently tracks normalized pointer position over a target element.

Data flow: `main.ts` generates a terrain → renders it onto the renderer's canvas → mounts that canvas into `#app` → attaches senses to the canvas. Each module is a factory returning an interface; they depend on each other only through exported types (`renderer` imports `Terrain` as a type). Keep that boundary: modules talk via typed data structures, not shared globals.

Intra-`src` imports use explicit `.ts` extensions (e.g. `import ... from "./renderer/index.ts"`), enabled by `allowImportingTsExtensions`. Follow that convention in new files.

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
