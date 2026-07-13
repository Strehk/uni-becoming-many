# Divergence map & merge assessment

## The fork

```
                      ┌─ 3427e22 Add modular sense experience system
                      ├─ ada0c3f Separate playback and configuration modes
                      ├─ ebd5e5a Use Theatre timeline as playback authority
   c17c671 ───────────┤  dd8edf2 Open Theatre Studio on disk timeline state
   (merge base)       ├─ 78d1473 Hide debug overlays in Theatre configuration
                      ├─ 03a9d78 Keep configuration tools accessible in Studio mode
                      └─ cddd064 Unify Theatre configuration controls   ← this branch HEAD
                      │
                      ├─ 4a4c2a1 force WebGPU Renderer
                      ├─ 0679646 Fix lake rendering
                      ├─ cf78f5e Stop forcing WebGL; sort minimap import
                      ├─ 94a22aa Hide the river water ribbons
                      ├─ 8b41f59 Fill world with instanced flora (signal substrate)
                      ├─ 5d71d57 Raise flora density
                      ├─ d745cea Pack flora instances
                      └─ 57b6f0d Add stationary dust motes   ← main HEAD
```

Two lineages from one ancestor. **Neither contains the other.** Branch name says
"Merge_Erasmus" — the intent was clearly to integrate the designer prototypes
(the Erasmus/design-team sense modules per MASTERPLAN §1), which it did. But the
merge *back into `main`* has not happened, and `main` moved on in parallel.

## What each side uniquely has

| Branch only | `main` only |
|---|---|
| `src/senses/{shader,duft,magnetfeld,motion,netzwerk,rundum}/` (6 sense modules) | `src/life/` (instanced flora) |
| `src/synth/` (vendored Tone.js app + host bridge) | `src/atmosphere/` (dust motes) |
| `src/creatures/` (boids + mushroom substrate) | `src/render/` (tsl-kit helpers) |
| `src/experience/` (start menu, interface modes, config) | Lake-geometry fix, hidden river ribbons |
| `src/senses/{ids,director}.ts` + layered signals | Forced-WebGPU renderer backend |
| `src/dev-console/{sense,world}-controls.ts` | — |
| Theatre nine-sense envelopes + authority gating | — |
| `docs/MASTERPLAN.md`, `AGENT.md` | — |

## The hard incompatibility: the `SenseId` vocabulary changed

This is the single biggest merge obstacle. The two branches define **different,
overlapping-but-incompatible** sense sets:

```ts
// main  (7, exclusive modes)
type SenseId = "luft" | "echo" | "infrarot" | "duft" | "netzwerk" | "depth" | "normal";

// branch (9, layerable)
type SenseId = "farben" | "echo" | "infrarot" | "uv" | "duft"
             | "netzwerk" | "motion" | "magnetfeld" | "rundum";
```

- Renamed/re-conceived: `"normal"` → `"farben"`; `"luft"` (a sense on main) → `null`
  (the void / all-off on the branch).
- Dropped on the branch: `"depth"`.
- Added on the branch: `"uv"`, `"motion"`, `"magnetfeld"`, `"rundum"`.
- Kept: `echo`, `infrarot`, `duft`, `netzwerk`.

Because this type is imported by the signal registry, Theatre envelopes, the synth
map, the dev UI, and every sense module, the vocabularies **cannot be merged by
Git line-resolution** — it requires a human decision on the canonical sense set,
then rewiring `main`'s `life`/`atmosphere`/`SenseProfile` code to it.

## Overlapping files that will conflict

- `src/signals/registry.ts` — both edited `activeSense`; branch added the whole
  `sense`/`senseAuthority` block. **Conceptual conflict** (single-mode vs layered).
- `src/senses/index.ts` — heavily rewritten on the branch (+/−344), different
  `SenseId`, different `createSenses` signature (`createSenses(bus)` vs
  `createSenses({ start })`).
- `src/terrain/render/water-material.ts` — divergent edits (branch: compositor
  rewrite; main: lake fix). **Semantic conflict.**
- `src/main.ts` — both rewrote the wiring around different module sets.
- `src/renderer/index.ts` — branch +27, main forced-WebGPU. Likely conflict.

## Merge recommendation

A straight `git merge` will produce large, semantically meaningless conflicts. The
sound path is a **directed integration**, and the direction should be
**port `main`'s content onto the branch's architecture**, because the branch's
sense/signal/Theatre plumbing is the newer design and `main`'s single-mode model is
its predecessor (see `02-architecture-...md`). Concretely:

1. **Decide the canonical `SenseId` set.** Almost certainly the branch's nine
   layers; decide the fate of `main`'s `"depth"` (drop or add as a 10th layer).
2. **Port `src/life/` (flora) onto the branch**, re-wiring it from `senses.uniforms`
   (old) to the new sense signals, and reconciling it with the **unlit terrain**
   rule — flora must also be gated on a sense signal and must not betray form in the
   white void. This is the largest single task.
3. **Port `src/atmosphere/` (dust)** the same way (it is already "a pure signal
   consumer", so this is lighter — mostly renaming the sense uniforms).
4. **Take `main`'s lake-geometry fix** into the branch's compositor-based
   `water-material.ts` by hand (cherry-pick the geometry math, not the file).
5. **Take the renderer backend decision** (`4a4c2a1` force WebGPU) — trivial, but
   confirm it against the branch's `renderer/index.ts` changes.
6. Bring `main`'s `src/render/tsl-kit.ts` only if the branch's terrain materials
   need it (check for duplication against the branch's own kit).

Do **not** merge in the other direction (branch → main by re-basing onto main's
sense model) — that would throw away the branch's superior architecture.

## Bottom line

`BecomingMany_Merge_Erasmus` and `main` are **two live forks that must be reconciled
by hand**, not a stale branch to fast-forward or delete. The branch carries the
better plumbing and the design-team's sense modules; `main` carries the world
population (flora/dust) and world-gen fixes. A real merge is a porting project, and
its riskiest steps are the `SenseId` reconciliation and re-homing flora onto the
unlit, layered-sense terrain.
