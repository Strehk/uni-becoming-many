# Merge difficulty assessment (empirical)

**Question:** how hard is it to merge `BecomingMany_Merge_Erasmus` into `main`?

**Verdict: HARD — this is a porting project, not a merge.** A `git merge` is not the
right tool. The git-visible conflicts are the *small* part; the real cost is the
**silent semantic breakage** git auto-merges into code that won't compile.

Rated **8/10 difficulty**. Not because of conflict *count* (only 8 files), but
because two of them are near-total rewrites, one is a type-relocation modify/delete,
and underneath sits an incompatible sense architecture that git cannot see.

---

## Empirical result: I ran the merge in memory

`git merge-tree --write-tree main HEAD` (non-destructive) → **8 conflicted files**:

| File | Conflict kind | Why | Mechanical? |
|---|---|---|---|
| `src/main.ts` | content | Branch rewrote the wiring (**+200/−10**, 161→351 lines) around a different module set; main added life/atmosphere (+32/−9) | ❌ near-total rewrite |
| `src/senses/index.ts` | content | Branch rewrote (**+205/−139**) to the 9-layer model; incompatible `SenseId` | ❌ rewrite |
| `src/terrain/world.ts` | content | Both edited (branch +62/−15 unlit+compositor; main +45/−2) | ⚠️ hand-splice |
| `src/terrain/render/terrain-material.ts` | content | Branch's compositor rewrite vs main | ⚠️ |
| `src/terrain/render/water-material.ts` | content | Branch compositor vs **main's lake fix** — both semantic | ❌ cherry-pick main's math by hand |
| `src/terrain/render/uniforms.ts` | **modify/delete** | **Main deleted it** (moved `KitUniforms` to `src/render/uniforms.ts`); branch modified it | ❌ type relocation, see below |
| `src/terrain/index.ts` | content | KitUniforms re-export + chunk hooks | ⚠️ |
| `bun.lock` | content | Different deps (branch adds Tone/Theatre) | ✅ regenerate with `bun install` |

Auto-merged **without** a conflict (but several are semantically wrong — the
dangerous ones): `package.json`, `src/renderer/index.ts`, `src/signals/registry.ts`,
`src/terrain/chunk.ts`.

## The silent landmines (git says "clean", compiler says no)

These are why the difficulty is 8 and not 4. `main`'s new modules were never written
against the branch's API, and git happily merges them in:

### 1. `SenseId` vocabulary is incompatible AND relocated
- Branch: `SenseId` lives in `src/senses/ids.ts`, 9 layers
  (`farben/echo/infrarot/uv/duft/netzwerk/motion/magnetfeld/rundum`).
- Main: `SenseId` lives in `src/senses/index.ts`, 7 exclusive modes
  (`luft/echo/infrarot/duft/netzwerk/depth/normal`).
- Main's `life/index.ts` and `atmosphere/index.ts` do
  `import type { SenseId } from "../senses/index.ts"` and lean on
  `SENSE_PROFILES` keyed by `luft/depth/normal` — **senses that don't exist on the
  branch.** After merge these files import a type that moved and reference three
  senses that were deleted. Won't compile.

### 2. `KitUniforms` was relocated out from under main's modules
- Branch: `KitUniforms` is sourced from `src/terrain/render/uniforms.ts` (6 files
  depend on that path).
- Main: **deleted** `src/terrain/render/uniforms.ts` and put `KitUniforms` in a new
  `src/render/uniforms.ts`; `life/` and `atmosphere/` import from `../render/`.
- The merged tree ends up with **both** `src/render/uniforms.ts` (from main) and a
  conflicted `src/terrain/render/uniforms.ts` (branch). Every import must be picked to
  one home, and the two `KitUniforms` shapes reconciled.

### 3. Old vs new sense plumbing cannot coexist
- Branch `registry.ts`: `sense: Record<SenseId,Signal>` + `senseAuthority` + dominant
  `activeSense: SenseId|"none"`.
- Main `registry.ts`: `activeSense: signal<SenseId>("normal")`, no `sense` cells.
- Main's `createSenses({start:"normal"})` (a `SenseManager` state machine) vs branch's
  `createSenses(bus)` (director + layers). `life`/`atmosphere` call the **main** API
  and read `senses.uniforms`; that API is gone on the branch.

## Difficulty by concern

| Concern | Difficulty | Note |
|---|---|---|
| `bun.lock` | Trivial | delete + `bun install` |
| `package.json` | Trivial | union of deps; auto-merge likely fine, verify |
| Terrain material/uniforms/world conflicts | Medium | hand-splice; both sides know TSL |
| Water material (lake fix vs compositor) | Medium-High | port main's lake geometry into branch's compositor by hand |
| `main.ts` wiring | High | reconstruct: branch wiring + life/atmosphere added |
| `senses/index.ts` + registry | High | rewrite is the branch's; discard main's single-mode |
| **`SenseId` reconciliation** | **High** | pick canonical set; decide fate of `depth`; touches registry, theatre, synth, dev UI, life, atmosphere |
| **Re-home flora/dust onto new architecture** | **Highest** | rewire `life`/`atmosphere` to branch sense signals + the **unlit "white void"** rule (lit flora contradicts it) |

## Why it's hard in one sentence

The two branches didn't just edit different files — **main built new content
(flora, dust) on top of the *old* sense/uniform architecture that the branch
deleted and replaced**, so bringing main's content across means rewriting it against
the branch's new plumbing, and git's 8 conflicts hide that the merged tree won't even
typecheck until that rewrite is done.

## Effort shape (not a merge, a port)

Recommended direction: **port main's content onto the branch** (the branch has the
newer architecture — see `02-...md` and `03-...md`), then merge *that* into `main`.

Rough phasing (see `03-...md` for the full plan):
1. Resolve the 8 textual conflicts favouring the branch's architecture — **~½–1 day.**
2. Make it typecheck: reconcile `SenseId` set + `KitUniforms` home; delete main's
   dead single-mode `senses` code — **~1 day.**
3. Re-home `atmosphere/` (dust) to branch sense signals — **~½ day** (it's already a
   pure signal consumer).
4. Re-home `life/` (flora) to branch sense signals **and** the unlit/void rule, gate
   it on a sense — **~1–2 days** (the real work; touches instancing + material).
5. Port main's lake-geometry fix into the branch's water compositor; take the
   forced-WebGPU decision — **~½ day.**
6. `bun run build` (typecheck gate) + `bun run check` green; visual verify the void,
   flora reveal, and lakes — **~½ day.**

**Ballpark: 3–5 focused days** for someone who knows both sides, dominated by steps
2 and 4. A blind `git merge && fix conflicts` will *appear* done in an hour and then
fail to compile — avoid that trap.

## What would have made it easy (and didn't happen)
If the branch had been kept rebased on `main` (or merged back after each sense
module landed), each side would share the sense architecture and this would be a
routine merge. The divergence in the **`SenseId`/uniforms foundation** is what turns
it into a port. For next time: land architectural changes to `signals`/`senses`
on `main` first, then build features on top.
