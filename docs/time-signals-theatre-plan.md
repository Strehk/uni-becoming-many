# Time, Signals & Theatre.js Integration Plan

**Target:** `becoming-many` (Vite 6 + vanilla TS + three.js r185 **WebGPU/TSL**, bun, HTTPS, WebXR).
**Source of ideas:** `neural-flight-template/src/lib/experiences/becoming-many` — the `clock.ts` time spine, the `audio.ts` cue director, and the `senses.ts` state machine. **Ported conceptually, not copied**: the reference is SvelteKit-embedded and renderer-coupled through its `/vr` loader; here we own the loop directly (`renderer.start`) and want a decentralised, signal-first backbone the reference never had.

Goal: a **single time spine** feeding a **reactive signal + event substrate** that objects subscribe to and push onto, with **Theatre.js layered on top as the authored-envelope + live-tuning tool** — not as the timeline owner. Three layers, one clock, strict ownership rules.

---

## 0. TL;DR — the shape of the thing

```
                         ┌───────────────────────── FRAME LOOP (renderer.start) ─────────────────────────┐
   real dt ──►  Clock.advance(dt) ──► fires time-cues ──► publishes  signals.time                        │
                     │ (virtual time: pause/seek/timeScale — the ONE authority)                          │
                     ▼                                                                                    │
        if running:  sheet.sequence.position = clock.now                                                 │
                     │                                                                                    │
   ┌─────────────────▼───────────────┐        ┌──────────────────────────────────────────────┐          │
   │        THEATRE.js (core)         │  pull  │              SIGNAL SUBSTRATE                  │          │
   │  authored keyframes / envelopes  │───────►│  named reactive cells:                        │          │
   │  "director's slow arc"           │ writes │   time · playerPose · activeSense · progress  │          │
   │  (studio = dev-only editor)      │  ONLY  │   unrest · intensity(authored) · …            │          │
   └──────────────────────────────────┘ authored└──────┬───────────────────────────┬───────────┘         │
                                          signals       │ subscribe (coarse)        │ peek() (hot path)   │
                                                         ▼                           ▼                     │
                                              ┌────────────────────┐     ┌────────────────────────┐        │
                                              │   EVENT BUS         │     │  per-object behaviour   │        │
                                              │  emit / on / when   │◄───►│  reads signals, decides │        │
                                              │  (signal crossings: │emit │  locally: chirp, spawn, │        │
                                              │  time·proximity·    │     │  animate, play sound    │        │
                                              │  sense-change)      │     └────────────────────────┘        │
                                              └─────────┬───────────┘                                       │
                                                        │ 'cue:*'                                           │
                                                        ▼                                                   │
                                              SoundDirector (Web Audio) ── senses.update ── world.update ── render
                                                                                                            │
   └────────────────────────────────────────────────────────────────────────────────────────────────────┘

  OWNERSHIP LAW:  every signal has exactly ONE writer.  Authored ⇒ Theatre writes it.  Emergent ⇒ a system computes it.  Never both.
  ALTITUDE LAW:   Theatre = slow authored envelopes.  Signals = reactive state.  Objects = fast local decisions combining both.
  PERF LAW:       subscribe() for event-rate/coarse state.  peek() (plain read) in the per-frame hot path.  Never route 80k particles through reactivity.
```

Everything above the signal substrate is **producers**; everything below is **consumers**. The substrate is the only shared truth, and the three laws are what keep two powerful systems (an authored timeline and an emergent event graph) from fighting over the same world.

---

## 1. Design principles

These are the load-bearing decisions. Everything downstream is mechanics.

1. **One spine.** The `Clock` is the sole owner of *time*: virtual elapsed seconds, `pause`/`resume`/`seek`/`timeScale`. Nothing else advances time. Theatre's sequence playhead is *slaved* to it (`sequence.position = clock.now`), never the reverse. This preserves pause/seek/timeScale over *all* animation, authored or emergent, for free.

2. **Signals are the substrate, not Theatre.** Becoming Many is player-driven (ICAROS / keyboard) — most behaviour is *emergent from state* (position, sense mode, proximity), which cannot be authored frame-by-frame. So the reactive signal graph is the backbone; Theatre is one producer that writes a *handful* of authored signals on top.

3. **Altitude separation.** Three tiers, each with a distinct rate and job:
   - **Theatre** → slow *authored envelopes* (the 8-min dramaturgical arc: `unrest`, `intensity`, a scripted camera move).
   - **Signals** → *reactive state* everything reads (`activeSense`, `playerPose`, `senseProgress`, `time`).
   - **Objects** → *fast local decisions* that combine both ("chirp iff `activeSense==echo` **and** near player **and** `random < unrest`").

4. **One writer per signal (the anti-swamp law).** Partition every parameter into **authored** (Theatre owns it) vs **emergent** (a system computes it) — *never both*. The classic disaster is Theatre keyframing `fogColor` while the sense state machine also lerps it: "who set the fog?" becomes unanswerable. Decide ownership per signal, once.

5. **Perf discipline (VR budget is first-class).** Fine-grained reactivity is for *event-rate* changes, not per-frame fan-out over 80k particles.
   - `subscribe()` only for coarse/rare transitions (sense switch, region entry, authored-envelope changes).
   - `peek()` (a plain field read, no tracking, no subscription) in the per-frame hot path.
   - Never build a reactive dependency graph that re-evaluates inside the render loop.

6. **Renderer-agnostic core.** Clock, signals, event bus, and the audio director carry **no `three/webgpu` rendering types**. They deal in numbers, ids, and (at most) `Vector3`/`Color` value objects. This keeps them unit-testable and XR-safe.

---

## 2. Layer A — the Clock (time spine)

**Where:** `src/time/clock.ts`. **Concept source:** reference `clock.ts` (`ExperienceClock`). Ported almost 1:1 conceptually — it is already excellent — with two deliberate changes.

**What it is.** A controllable *virtual* clock. The frame loop feeds it real `dt`; it produces a scaled virtual time with transport controls, and fires **discrete time-cues** as virtual time crosses their scheduled moments (frame-accurate, re-armed correctly on `seek`/`reset` so a jump never double-fires or bursts). This discrete-scheduling correctness is the reason we keep a bespoke clock rather than leaning on Theatre's playhead.

**Public shape (conceptual):**

```ts
class Clock {
  timeScale: number;                 // 1 realtime · 0.5 slow-mo · 2 fast-forward
  get now(): number;                 // virtual elapsed seconds — the spine
  get delta(): number;               // last virtual delta (already scaled)
  get running(): boolean;

  advance(realDt: number): void;     // called once per frame; fires due cues
  pause(): void; resume(): void; toggle(): void;
  reset(): void;                     // t→0, re-arm every cue
  seek(t: number): void;             // jump; re-arm future cues, mark passed as fired (no burst)

  schedule(at, action, opts?): Handle // one-shot / repeat / offset / repeat-cap
  every(interval, action, opts?): Handle
  cancel(idOrHandle): void; clear(): void;
}
```

**Two changes from the reference:**

- **Publishes into a signal.** After `advance`, it writes `signals.time.value = this.now`. That is the *only* bridge between the clock and the reactive world; consumers never poll the clock object directly.
- **Its scheduler is reframed as "the time-specialised event source."** `clock.schedule(at, …)` is conceptually `bus.when(signals.time, t => t >= at, …)` with correct re-arm semantics. We keep the clock's implementation (its seek re-arm logic is hard to get right and audio depends on it) but *document* it as one producer on the event bus (§3), so audio cues and proximity cues feel like one system.

**What it explicitly does NOT do:** own continuous parameter animation (that's Theatre + signals), know about senses/audio/rendering, or touch the DOM.

---

## 3. Layer B — the Signal & Event substrate

**Where:** `src/signals/` (`signal.ts`, `registry.ts`, `bus.ts`). **Concept source:** none in the reference — this is the new backbone. The reference wired cues *directly* to the clock; we generalise to "any object subscribes to / pushes onto named reactive state."

### 3.1 The `Signal<T>` primitive

A ~30-line reactive cell. No auto-tracking magic (deliberately — see Perf Law).

```ts
interface Signal<T> {
  value: T;                                   // get; set notifies subscribers iff changed (Object.is)
  peek(): T;                                  // read WITHOUT subscribing — the hot-path accessor
  subscribe(fn: (v: T) => void): () => void;  // returns an unsubscribe; fires on change only
}
function signal<T>(initial: T, equals?): Signal<T>
```

Decision to make (§9 Q1): hand-roll this, or depend on `@preact/signals-core` (tiny, framework-agnostic, battle-tested) and forbid its `effect()` auto-tracking in the hot path. Recommendation: **hand-roll** — 30 lines, zero deps, and we never want the auto-tracking anyway.

### 3.2 The named registry

One module exporting the world's shared cells, each annotated with its **single writer** (enforced by convention + a comment, optionally a dev-only guard):

```ts
export const signals = {
  // ── emergent (a system computes these) ──
  time:          signal(0),                    // WRITER: Clock
  playerPose:    signal({ pos: Vec3, quat }),  // WRITER: player/update
  activeSense:   signal<SenseId>('normal'),    // WRITER: sense state machine
  senseProgress: signal(1),                    // WRITER: sense state machine (0..1 transition)
  controlQuality:signal(0),                    // WRITER: icaros host

  // ── authored (Theatre writes these) ──
  unrest:        signal(0),                    // WRITER: Theatre 'Timeline' sheet
  intensity:     signal(0),                    // WRITER: Theatre 'Timeline' sheet
};
```

Consumers import `signals` and either `subscribe` (coarse) or `peek` (hot path). This is the whole "objects subscribe and push to" surface.

### 3.3 The event bus (push + subscribe + crossings)

Signals carry *state*; the bus carries *moments*. It is what lets an object "decide for itself" and lets any object "push."

```ts
interface Bus {
  on(type: string, handler: (payload) => void): () => void;   // subscribe
  emit(type: string, payload?): void;                          // push
  when(sig: Signal<T>, predicate: (v)=>boolean, handler): ()=>void; // edge-triggered crossing
}
```

- **`when(signal, predicate, handler)`** fires once on the *rising edge* of `predicate` (false→true). This generalises the clock's time scheduler to **any** signal: proximity (`when(signals.playerPose, p => near(p, landmark), …)`), sense change, control quality, an authored envelope crossing a threshold.
- **Discrete audio cues** become `bus.emit('cue:echo-ping')` handlers, wired either from `clock.schedule` (time) or `bus.when` (proximity/sense). The `SoundDirector` (ported from reference `audio.ts`) subscribes to `cue:*` and plays clips — decoupled from *why* the cue fired.
- **"Objects push"**: a moth instance does `bus.emit('moth:caught', { id })`; the score system and an audio stinger both `on('moth:caught', …)`. Neither knows about the other.

### 3.4 The "object decides for itself" pattern (the modular vision)

An instance, in its setup, wires what it cares about; in the loop, it reads and decides locally:

```ts
// creature.ts — one instance, fully self-contained
const stop = bus.on('sense:changed', ({ id }) => { this.mood = id === 'echo' ? 'alert' : 'calm'; });

update(dt) {
  const p = signals.playerPose.peek();          // hot-path read, no subscription
  const unrest = signals.unrest.peek();          // Theatre's authored arc modulates behaviour
  if (this.mood === 'alert' && near(p, this.pos) && this.cooldown <= 0 && rand() < unrest) {
    bus.emit('cue:chirp', { at: this.pos });     // push — SoundDirector/others react
    this.cooldown = 0.5;
  }
}
```

Theatre set the *macro* (`unrest` rising toward the climax); signals carried the *reactive* state (`activeSense`, `playerPose`); the instance made the *local* decision. No central conductor, no fight.

---

## 4. Layer C — Theatre.js integration

**Where:** `src/theatre/` (`project.ts`, `bindings.ts`, `bridge.ts`, `state.json`). **Packages:** `@theatre/core` (ships to prod) + `@theatre/studio` (dev-only). Add to `package.json` deps/devDeps respectively.

### 4.1 The `@theatre/r3f` caveat (read first)

Theatre's official *3D* extension — the in-viewport gizmos + snapshot editor — is **`@theatre/r3f`, and it requires React-Three-Fiber.** This project is vanilla `three/webgpu` with **no React**, so `@theatre/r3f` is **out of scope**. We reconstruct its *useful* part (binding a scene object's transform/props to a Theatre object) as a ~20-line vanilla helper (§4.4). We lose drag-in-scene gizmos; we keep the timeline, keyframes, property panel, easing curves, and — crucially — the exported `state.json`. This is the right trade for a non-React codebase and must not be discovered mid-install.

### 4.2 Project, sheets, objects

```ts
// project.ts
import { getProject, types } from '@theatre/core';
import state from './state.json';               // committed authored state (placeholder to start)

// In prod, load baked state; in dev, let Studio own/persist it.
export const project = getProject('Becoming Many', import.meta.env.DEV ? undefined : { state });

// Sheets = scenes/scopes. Objects = keyframable prop bags.
export const sheets = {
  timeline: project.sheet('Timeline'),  // authored envelopes: unrest, intensity
  senses:   project.sheet('Senses'),    // live-tunable SenseProfile fields (Level 1)
  camera:   project.sheet('Camera'),    // scripted macro moves (Level 2)
};
```

Object shapes use Theatre's typed props (`types.number` with ranges, `types.rgba` for colours, `types.compound` for vectors, `types.stringLiteral` for enums). Example senses object mirrors `SenseProfile` (viewRadius, fog, rim, colours) so the hardcoded magic numbers in the reference's `senses.ts` become *authored* values.

### 4.3 Dev-only Studio + the export path

```ts
// project.ts (continued)
if (import.meta.env.DEV) {
  const studio = (await import('@theatre/studio')).default;  // dynamic ⇒ tree-shaken from prod
  studio.initialize();
  // Tip: studio.createContentOfSaveFile('Becoming Many') returns the state object;
  // JSON.stringify it to regenerate state.json without the Studio UI export button.
}
await project.ready;   // await before driving the sequence in prod (state must be applied)
```

**Production save format (the question that started this):** Studio auto-persists edits to browser localStorage while you tune. When happy, export the project state → a single **`state.json`** (all sheets, objects, keyframes, easing) → **commit it under `src/theatre/state.json`** → prod imports it via `{ state }` and never loads Studio. Declarative, diffable, version-controlled.

**Placeholder:** commit a minimal valid `state.json` now (Theatre accepts an empty-ish project state) so `project.ts` type-checks and imports cleanly before any real authoring exists. Replace it the first time you export from Studio.

### 4.4 The vanilla binding helper (our `@theatre/r3f` stand-in)

```ts
// bindings.ts — bind a THREE.Object3D transform to a Theatre object (pull model)
export function bindTransform(obj: THREE.Object3D, tObj: TheatreObject) {
  // per frame, AFTER sequence.position is set:
  const v = tObj.value;                 // { position:{x,y,z}, rotation:{x,y,z} }
  obj.position.set(v.position.x, v.position.y, v.position.z);
  obj.rotation.set(v.rotation.x, v.rotation.y, v.rotation.z);
}
```

Read `.value` each frame (pull) rather than `onValuesChange` (push) — pull composes cleanly with a sequence driven by our clock and needs no teardown.

### 4.5 The authored→signal bridge (enforces the one-writer law)

Theatre must only ever write **authored** signals. The bridge is the single sanctioned crossing:

```ts
// bridge.ts — copy authored Theatre values into their signals, once per frame
export function pumpAuthored() {
  const t = sheets.timeline.object('arc', { unrest: types.number(0,{range:[0,1]}), intensity: types.number(0,{range:[0,1]}) });
  signals.unrest.value = t.value.unrest;         // Theatre is the SOLE writer of these
  signals.intensity.value = t.value.intensity;
}
```

Emergent signals (`activeSense`, `playerPose`) are **never** touched here — that's the law in code.

### 4.6 Sequence driven by the clock + the Studio-playhead subtlety

Drive Theatre's playhead from the spine, but **only while the clock is running**, so Studio can scrub freely when you pause to author:

```ts
if (clock.running) sheets.timeline.sequence.position = clock.now;  // clock owns time when playing
// when paused for authoring, Studio owns the playhead — no fight
```

Set each sheet's sequence length to the piece length (~8 min) in Studio. You never call `sequence.play()` — the clock *is* the transport.

---

## 5. Frame-loop integration (`main.ts`)

The ordering is load-bearing — producers before consumers, authored before reactive, state before decisions:

```ts
renderer.start((dt) => {
  // ── PRODUCE ──
  clock.advance(dt);                               // 1. spine advances, time-cues fire, signals.time updated
  if (clock.running)                               // 2. slave Theatre's playhead to the spine
    sheets.timeline.sequence.position = clock.now;
  pumpAuthored();                                  // 3. authored Theatre values → authored signals
  keyboard.update(dt);                             // 4. input → (player writes) emergent signals
  player.update(dt, steer);                        //    writes signals.playerPose
  senses.update(dt);                               //    writes signals.activeSense / senseProgress; lerps uniforms

  // ── REACT ──
  bus.tick();                                      // 5. evaluate `when` crossings (proximity/sense/threshold) → emit
  // (per-object behaviour reads signals.peek() + bus events, decides locally, may emit more)

  // ── CONSUME ──
  world.update(pose.pos.x, pose.pos.z);            // 6. terrain streams around the player
  // render happens inside renderer.start
});
```

`bus.tick()` is where edge-triggered `when(signal, predicate)` crossings are sampled once per frame (cheap: a predicate eval per registered crossing, only for coarse signals).

---

## 6. How existing modules plug in

| Module | Today | Change |
|---|---|---|
| `renderer/index.ts` | owns `renderer.start((dt)=>…)` loop | unchanged — it already hands us `dt`; the whole spine lives in the `onFrame` callback |
| `senses/index.ts` | **pointer stub only** | grows into the real sense state machine (port reference `senses.ts` `SenseManager`): reads `signals.activeSense`, writes `senseProgress`, lerps TSL uniforms; its `SENSE_PROFILES` become the Theatre 'Senses' sheet (Level 1 live-tuning) |
| `player/index.ts` | flies forward, carries camera | writes `signals.playerPose` each frame; optionally a Theatre 'Camera' sheet drives scripted macro moves (Level 2) via `bindTransform` |
| `icaros/index.ts` | `onOrientation` callback | writes `signals.controlQuality` + feeds player steering; a `when(controlQuality, q=>q<threshold, …)` can drive a "signal lost" cue |
| `terrain/index.ts` | `world.update(x,z)` from rig XZ | unchanged; reads `signals.playerPose.peek()` instead of the raw rig if convenient |
| `dev-console/index.ts` | FPS/GPU overlay | add a transport strip (play/pause/seek/timeScale on the clock) + a live signal inspector — invaluable while authoring |
| audio (new) | — | port reference `audio.ts` `SoundBus`+`SoundDirector`; subscribes to `bus.on('cue:*')`; time cues via `clock.schedule`, reactive cues via `bus.when` |

---

## 7. File layout

```
src/
  time/
    clock.ts            # virtual clock + time-cue scheduler (concept-port of reference clock.ts)
  signals/
    signal.ts           # Signal<T> primitive (value/peek/subscribe)
    registry.ts         # the named `signals` object + single-writer annotations
    bus.ts              # event bus: on/emit/when(crossings)/tick
  theatre/
    project.ts          # getProject + sheets + dev-only studio + await ready
    bindings.ts         # bindTransform (vanilla @theatre/r3f stand-in)
    bridge.ts           # pumpAuthored: authored Theatre values → authored signals
    state.json          # COMMITTED authored project state (placeholder first)
  audio/                # (M-audio) SoundBus + SoundDirector, cue subscriber
    index.ts
  senses/index.ts       # grows from pointer stub → SenseManager reading signals
  main.ts               # wires the frame-loop ordering in §5
docs/
  time-signals-theatre-plan.md   # this file
```

---

## 8. Phased milestones

Each phase is independently demoable and leaves the app runnable.

### P1 — The spine (clock + signals, no Theatre yet)
- Port `Clock` into `src/time/clock.ts`; add `advance(dt)` to the `main.ts` loop; publish `signals.time`.
- Land `Signal<T>` + registry + bus with `on/emit/when/tick`.
- Prove it: a `clock.schedule` cue and a `bus.when(signals.time, …)` crossing both `console.log`. Dev-console gains play/pause/seek. **Gate:** pause/seek visibly stop/rewind time; no double-fire on seek.

### P2 — Senses on signals (Level 1 value authoring)
- Port `SenseManager` into `senses/index.ts`; drive it from `signals.activeSense`; publish `senseProgress`.
- Move `SENSE_PROFILES` into the Theatre 'Senses' sheet; wire dev-only Studio; export the first real `state.json`. **Gate:** live-tune fog/rim/colours in Studio, values persist to `state.json`, prod build loads them with Studio absent.

### P3 — Theatre timeline slaved to the clock (Level 2)
- `sheets.timeline.sequence.position = clock.now` (running-guarded); `pumpAuthored` bridges `unrest`/`intensity`.
- Author one macro envelope end-to-end; verify pause/seek/timeScale drive it through the clock. **Gate:** scrub the 8-min arc; an authored signal visibly modulates a consumer.

### P4 — Audio on the bus
- Port `SoundBus`+`SoundDirector`; subscribe to `cue:*`; wire time cues (`clock.schedule`) and a reactive cue (`bus.when` proximity/sense). **Gate:** a time cue and a proximity cue both fire correctly across pause/seek.

### P5 — Object-local behaviour (the modular payoff)
- First self-contained instance (a creature or landmark) that reads signals via `peek`, listens on the bus, and emits its own cues — zero central wiring. **Gate:** its behaviour emerges purely from signals + events; deleting it leaves no dangling references.

---

## 9. Risks & open questions

**Risks**
- **Two-system fight.** An authored signal and an emergent system both writing one cell is the #1 failure mode. Mitigation: the single-writer annotation in `registry.ts` + an optional dev-only "signal written twice this frame" guard.
- **Reactivity in the hot path.** Subscribing per-frame consumers (esp. anything per-particle) would tank the VR budget. Mitigation: `peek()` is the documented hot-path accessor; `subscribe` reserved for coarse transitions; code-review gate on new `subscribe` calls in loops.
- **Theatre maturity.** Pre-1.0 (0.7.x), slowed development. Mitigation: it stays a *leaf* — it only writes authored signals via `bridge.ts` and tunes senses; the clock/signals/behaviour never import it, so it's removable in an afternoon.
- **`@theatre/r3f` unavailable** (React-only) — no in-scene gizmos. Accepted; `bindTransform` covers the need.
- **Studio ↔ clock playhead contention** while authoring. Mitigation: the `if (clock.running)` guard hands the playhead to Studio when paused.

**Open questions (decide before/within the noted phase)**
1. **Hand-rolled `Signal<T>` or `@preact/signals-core`?** (P1) — recommend hand-rolled (30 lines, no dep, no auto-tracking we'd have to forbid anyway).
2. **Do audio cues generalise to `bus.when`, or stay time-only on `clock.schedule`?** (P4) — recommend both: time cues on the clock, proximity/sense cues on the bus, one `cue:*` subscriber.
3. **How much of the piece is authored vs emergent?** (P3) — sizes Theatre's footprint. Current read: a few macro envelopes + camera, everything else emergent.
4. **Should `signals.playerPose` hold a live `Vector3`/`Quaternion` (mutated in place, cheap) or immutable snapshots (safe, allocs)?** (P1) — recommend a mutated-in-place value with a version counter; `peek` returns the live object, `subscribe` fires on the version bump.
5. **Dev-only double-writer guard — worth the bookkeeping?** (P1) — recommend yes, cheap and catches the #1 risk early.
6. **Sequence length & timecode** for the 8-min arc — pin it so authored keyframes have a stable domain. (P3)

## 10. Definition of done

The backbone is "done" when: the **clock** is the only thing advancing time and its transport (pause/seek/timeScale) governs *every* animation, authored or emergent; **signals** carry all shared reactive state with one documented writer each; the **event bus** lets any object subscribe and push, with time *and* proximity/sense cues flowing through one `cue:*` path; **Theatre** live-tunes the senses and authors the macro arc, slaved to the clock, exporting a committed `state.json` while Studio is fully absent from the production bundle — and a single self-contained object instance demonstrates emergent behaviour with zero central wiring.
```
