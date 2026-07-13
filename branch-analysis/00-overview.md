# Branch analysis — `BecomingMany_Merge_Erasmus` vs `main`

**Date:** 2026-07-13 · **Analyst:** automated code review
**Merge base:** `c17c671` (both branches share this ancestor, then diverged)

---

## TL;DR

This branch is **not a stale copy of `main`**. Both branches did substantial,
*independent* work after the common ancestor and now point in **different directions**:

| | `BecomingMany_Merge_Erasmus` (this branch) | `main` |
|---|---|---|
| Commits since merge-base | 7 | 8 |
| Theme | **Sense modules + synth + experience shell + Theatre timeline authority** | **World population: flora, dust, lakes, WebGPU** |
| Senses model | **9 layerable senses** (new architecture) | 7 exclusive modes (old architecture) |
| New top-level modules | `creatures/`, `experience/`, `senses/{duft,magnetfeld,motion,netzwerk,rundum,shader}`, `synth/` | `atmosphere/`, `life/`, `render/` |
| Net size | **+14,818 / −263 lines**, 83 files | flora/dust/lake work |

So: **the vibe-coding on this branch changed a great deal**, and it changed
*different* areas than `main` did. The two histories have both moved forward and
**neither is a subset of the other**.

## Direct answers to the two questions

### 1. "Is this branch just a stale branch from main, or did the vibe coding change world generation & assets?"

**Neither purely.** The vibe coding on this branch changed world *rendering*
significantly (the terrain became **unlit**, revealed only by sense layers — a
paradigm shift, see `01-world-generation-and-assets.md`), and touched
`water-material.ts`, `terrain-material.ts`, `world.ts`. But the branch **missed
everything `main` added to world generation**: instanced flora (`life/`),
atmospheric dust (`atmosphere/`), the lake-rendering fix, hidden river ribbons,
and the forced-WebGPU renderer. Those live only on `main`.

There are **no binary assets** in either branch — the world is fully procedural
(terrain from noise, creatures from boids, no `.glb`/`.png`/`.hdr` in the tree).
"Assets" here means generation code. See `01-world-generation-and-assets.md`.

### 2. "Is the architecture clean — signals as the only top comm layer, clean module separation, Theatre on top of signals without a parallel obsolete comms layer?"

**On this branch: yes, and notably cleaner / more evolved than `main`.** The
signal-substrate + event-bus is the sole top-level communication layer; the nine
sense modules are cleanly separated leaf modules; Theatre writes **only** authored
signals through a single gated bridge (`pumpAuthored`) and does **not** run a
second parallel channel. Static verification confirmed the one-writer law holds
(only the `SenseDirector` and the Theatre bridge ever assign `signals.sense[id]`).
Full detail and the one minor smell in `02-architecture-signals-modules-theatre.md`.

**Against `main`:** `main` still runs the *older* single-mode sense architecture
(exclusive `activeSense`, no `senseAuthority`, no director, Theatre writes only
`unrest`/`intensity`). So on the architecture axis **this branch is ahead of
`main`, not behind it.** That is the crux of the merge problem — see
`03-branch-vs-main-divergence-and-merge.md`.

## The files in this folder

- `00-overview.md` — this file.
- `01-world-generation-and-assets.md` — terrain/water/renderer changes, the unlit
  paradigm, and the world-population work that lives only on `main`.
- `02-architecture-signals-modules-theatre.md` — deep architecture audit: signals,
  bus, modular boundaries, the Theatre bridge, the synth boundary, verification.
- `03-branch-vs-main-divergence-and-merge.md` — the divergence map, the
  incompatible `SenseId` vocabularies, and what a merge actually requires.
- `04-new-subsystems-inventory.md` — inventory of every subsystem the branch added.
