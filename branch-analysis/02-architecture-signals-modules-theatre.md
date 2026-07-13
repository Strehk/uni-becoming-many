# Architecture audit — signals, modules, Theatre

The review asked specifically: is the architecture clean, with

1. **signals as the *only* top-level communication layer**,
2. on top of a **modular structure with clean separation of concerns**,
3. **Theatre.js layered on top of the signals** — not interfering, not running a
   **second parallel obsolete comms layer**?

Verdict for this branch: **yes on all three, and the branch realizes this design
more fully than `main` does.** Details, evidence, and the one minor smell below.

---

## The intended architecture (as documented)

`AGENT.md` and `docs/MASTERPLAN.md` state the contract clearly:

- **Two-part substrate**: `signals/` carry *state* (a named registry, one writer per
  cell — "the anti-swamp law"); `bus` carries *events/moments* (`emit`/`on`, plus
  `when(signal, predicate, handler)` for rising-edge crossings). Both are singletons
  in `src/signals/`.
- **Modules are factories**: each module is `createX(...)` returning an interface or
  teardown, depending on others "only through exported types … modules talk via
  typed data structures, not shared globals."
- **Theatre is layered on top**: "authored-envelope + live-tuning tool, not the
  timeline owner." The clock owns time; Theatre's playhead is *slaved* to it; Theatre
  writes **only authored signals** via one bridge (`pumpAuthored`).

## 1. Signals as the only top comm layer — ✅ holds

The frame loop in `src/main.ts` is a textbook **PRODUCE → REACT → CONSUME** ordering
and every cross-module interaction goes through `signals` or `bus`:

```
clock.advance → signals.time            (produce)
theatre.setPosition + pumpAuthored      (authored signals)
keyboard/player → signals.playerPose    (emergent signals)
senses/magnetfeld/duft/creatures/... update()  (each reads signals, no cross-calls)
bus.tick()                              (react: `when` crossings fire cues)
world.update(pose)                      (consume)
```

Modules do **not** hold references to each other for control. Where a module needs
another's *data* it is passed a typed accessor at construction, e.g. `duft` and
`creatures` receive `(x,z) => world.groundHeightAt(x,z)` — a function value, not the
world object. `netzwerk`/`motion` receive the `creatures` handle as a **read-only
perception source**, which is the documented "creatures are the host actor substrate
that netzwerk/motion perceive" relationship — a data dependency, not a comms channel.

### The one-writer law is verified, not just claimed
A static check of every assignment to the sense cells:

| signal | writers found | sanctioned? |
|---|---|---|
| `signals.sense[id].value` | `senses/director.ts` (manual path) + `theatre/bridge.ts` (theatre path) — **only these two** | ✅ exactly as documented |
| `signals.activeSense.value` | `senses/director.ts` only | ✅ |
| `signals.senseAuthority.value` | `main.ts` (start-menu transitions), `dev-console/sense-controls.ts`, `director.ts` | ⚠️ see smell below |

Commands into modules travel over the **bus** (`sense:set/toggle/solo/clear`,
`sense:param`, `sense:blend/move`), and the dev-console sense panel emits the *same*
commands as the 1–9 keys. There is no second dispatch mechanism.

## 2. Modular separation of concerns — ✅ clean

- Sense vocabulary is isolated in a dependency-free leaf `src/senses/ids.ts` so the
  registry, the director, and every sense module import it **without cycles**.
- Each sense is its own directory under `src/senses/<id>/` with a uniform coupling:
  subscribe to its signal (eased fade), read spine time from `signals.time`, take
  `sense:param` from the bus, cost nothing while faded out.
- The WebGPU/TSL hard rules are **respected**: no classic `three` imports outside
  the vendored synth, and **no GLSL leaked in** — a grep for `ShaderMaterial`,
  `gl_FragColor`, `vertexShader:`, `onBeforeCompile` finds nothing in `src/**`
  (excluding vendor). The MASTERPLAN's promised GLSL→TSL ports (netzwerk's two
  ShaderMaterials, rundum's little-planet fragment shader) **actually happened.**
- The `SenseDirector` is the textbook realization of "one writer": every switch-on
  is a bus command; it recomputes the dominant sense on *any* cell change (so the
  atmosphere follows Theatre and manual alike) and mirrors each change as
  `sense:changed` so objects/audio react without subscribing to nine signals.

## 3. Theatre on top, no parallel comms layer — ✅ holds

`src/theatre/project.ts` + `bridge.ts` implement exactly the "layered, not owner"
contract:

- The clock is the time authority; `theatre.setPosition(clock.now)` is called **only
  while the clock runs** (so Studio can scrub when paused). Theatre never advances
  time itself.
- `pumpAuthored(arc)` is the **single** crossing where Theatre writes the substrate.
  It writes `unrest` + `intensity` unconditionally, and the nine `sense[id]`
  envelopes **only while `signals.senseAuthority === "theatre"`**. Any manual bus
  command flips authority to `"manual"`, so the timeline and a tester share the same
  cells without fighting — the one-writer law, *gated in time* rather than violated.
- Theatre writes **no emergent cells** (`activeSense`, `playerPose` are never touched
  in the bridge) — the comment says so and the code matches.
- **No second/obsolete channel.** The former `Camera` sheet (flight recording/
  playback) was deliberately dropped; `bindings.ts` remains only as a generic
  transform helper. There is no shadow event system, no direct Theatre→module calls.
  Theatre's only output is authored signals.

## The synth boundary — a bridge, not a parallel comms layer ✅ (with a caveat)

`src/synth/index.ts` pushes a `window.__bmFrame` packet into a **same-origin iframe**
each frame (`src/synth/vendor/` is the untouched Tone.js app). This *looks* like a
side channel but is correctly a **one-way, read-only projection of the substrate
across a process/vendor boundary**: it *reads* `signals` + pose/anchors and *writes
into the iframe*; it never writes back into `signals` or emits app bus events. The
vendored app is intentionally frozen JS (ignored by Biome/tsc), so a DOM-global
bridge is the sanctioned seam. This is the documented "one vendored exception" and
does not constitute a competing comms layer inside the core.

Caveat: this is the least type-safe seam in the codebase (`window.__bmFrame:
Record<string, unknown>`, hand-written `isSynthWindow`/`isSynthApp` guards). It is
correctly quarantined, but it is where future breakage will hide.

## The one architectural smell

`src/dev-console/sense-controls.ts` writes `signals.senseAuthority.value` **directly**
(both `"manual"` and `"theatre"`), rather than going through a bus command like every
other sense interaction. `main.ts`'s start-menu callbacks do the same for the
`"theatre"` reset. This is a **minor** deviation from "commands into modules go over
the bus": authority is a mode-switch, not a per-frame comms path, and only the
UI/entry layer does it — but it means the authority signal has three writers spread
across three files instead of a single director owning it. If you want the one-writer
purity to be total, route authority changes through a `sense:authority` bus command
handled by the `SenseDirector`. Low priority; not a correctness issue.

## Architecture verdict for this branch

**Clean.** Signals+bus are the sole top comm layer; modules are cleanly separated
factories talking only through typed data; Theatre sits on top through one gated
bridge with no parallel channel; the vendored synth is a correctly-quarantined
read-only boundary. The only nit is the authority-signal writer spread. This is a
**more disciplined** realization of the stated architecture than `main` currently
has (next section).

## The same architecture on `main` — the older, thinner model

`main`'s `signals/registry.ts` still has:

```ts
activeSense: signal<SenseId>("normal")   // ONE exclusive sense at a time
senseProgress: signal(1)
unrest / intensity                        // Theatre writes only these two
// no `sense` cells, no `senseAuthority`
```

`main` has **no `SenseDirector`, no bus-driven sense commands, no per-sense Theatre
envelopes, no authority gating**. Its senses are a single-mode state machine
(`SenseManager.switchTo`), and Theatre authors only the two macro envelopes. It is a
valid, clean-*enough* architecture — but it is the **predecessor** of the branch's
design. So "is the architecture clean on main?" → yes but simpler; "is the branch's
architecture a regression?" → **no, it is a forward evolution.** The tension is that
`main`'s newer *content* (flora/dust) is wired to this *older* sense plumbing.
