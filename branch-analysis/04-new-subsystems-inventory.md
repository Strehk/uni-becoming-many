# Inventory — subsystems the branch added

Everything below is **new on `BecomingMany_Merge_Erasmus` and absent from `main`**.
Line counts are added-lines from the diff against the merge base. All of it is the
"vibe-coded" integration of the designer prototypes (MASTERPLAN §1) plus the
experience shell around them.

## Sense modules (`src/senses/`)

| Module | Files (key) | ~LOC | What it is |
|---|---|---|---|
| `ids.ts` / `director.ts` | ids, director | 85 / 122 | The nine-sense vocabulary + the single manual writer of the sense signals (bus-command driven). The architectural spine. |
| `shader/` | index, sense-system, controls, blend-modes, surface, uniforms, uv-signals, param-tree, sense-types + `senses/{farben,echo,infrarot,uv}` | ~1,300 | Sense **A**: 4 shader senses (visible colour, echolocation, infrared, UV) + compositor, 8 blend modes, `SenseSurface` contract, UI descriptors, serialization. Composited into the terrain material via the `layers` option. |
| `duft/` | index, params, scent-field | ~1,070 | Sense **B**: GPU scent field (TSL compute, up to ~1M particles), wind/gusts/turbulence, scent zones scattered procedurally on terrain, re-anchoring as the player flies. |
| `magnetfeld/` | index, sky | ~1,100 | Sense **C**: geomagnetic sky dome with 9 blendable modes (aurora, field lines, iron filings, plasma, …), all uniforms. GLSL→TSL ported. |
| `netzwerk/` | index, swarm-network, mycelium-network | ~1,165 | Sense **D**: `SwarmNetwork` (link tubes + glow + signal particles between birds) and `MyceliumNetwork` (mycelium lines/hotspots between mushrooms). Two GLSL ShaderMaterials ported to TSL node materials. |
| `motion/` | index, sampler, trail-buffer, emission-profiles, target-adapters | ~780 | Sense **E**: particle trails from the birds' animated vertices; hides the bird meshes while active. |
| `rundum/` | index, little-planet | ~330 | Sense **F**: little-planet 360° projection as an exclusive **view mode** via `renderer.setRenderOverride`. GLSL fragment shader ported to TSL `cubeTexture`. |

`src/senses/index.ts` was rewritten (`createSenses(bus)`) to assemble these into the
atmosphere/uniform layer and expose `shader.compositor` for the terrain material.

## Synth (`src/synth/`)

- `index.ts` (351) — **host bridge**: same-origin iframe overlay (key **M**), pushes
  `window.__bmFrame` (pose, six flight values, nine sense intensities, four anchor
  positions) each frame; auto-adds the mapped synth layer on a sense's first rise.
- `vendor/**` (~4,900 LOC of JS + CSS) — the **untouched Tone.js app** (SynthModulHandy):
  `core/` (engine, layers, chords, motif, turing, spatial, generative), `flight/`
  (mapping incl. `SENSE_QUELLEN`), `patch/` (cable UI), `senses/registry.js` (8 sound
  senses × variants), `ui/`, `styles/`. Ignored by Biome, invisible to tsc, Tone
  pinned to 14.8.49. Runs standalone on `synth.html`.

## Creatures substrate (`src/creatures/`)

`index.ts` (278) — boids bird swarm + mushroom spawn points. Plain world state with
**no sense logic**; it is the *perception target* that `netzwerk` and `motion` read.
Emits `creatures:mushrooms-changed` on re-scatter. Birds are hidden in the void and
while `motion` is up (they keep flying so trails/web read live positions).

## Experience shell (`src/experience/`)

- `start-menu.ts` (589) — start/config menu; normal runs play the Theatre timeline.
- `interface-mode.ts` (275) — playback vs configure mode controller (toggles debug
  overlays, inspector, VR button, synth).
- `config.ts` (124) — `ExperienceConfig` load/save (localStorage).

These drive the `senseAuthority` = `"theatre"` transitions and the clock reset/seek
on Start/Test/Configure.

## Dev console additions (`src/dev-console/`)

- `sense-controls.ts` (401) — one card per sense layer (toggle/solo/intensity +
  module params from UI-agnostic descriptors); emits the **same bus commands** as
  keys 1–9.
- `world-controls.ts` (429) — live terrain-generator sliders (provider + GenParams);
  edits call `world.setParams()` and rebuild streamed chunks in place.

## Time / transport

The branch relies on `src/time/` (clock spine + `createTransport`) as the single time
authority that Theatre is slaved to. (Present at the merge base; central to the
branch's loop.)

## Terrain changes (recap — detail in `01-...md`)

`world.ts`, `render/terrain-material.ts`, `render/water-material.ts`,
`render/uniforms.ts`, `chunk.ts`, `index.ts` — the shift to **unlit** materials with
the sense-layer compositor and the live GenParams overlay.

## Docs & config

- `docs/MASTERPLAN.md` (314) — the authoritative integration plan/status (German).
- `AGENT.md` (11) — pointer/guidance addition.
- `vite.config.ts` (+8), `package.json` (+3, adds Tone + Theatre deps), `biome.json`
  (ignore `synth/vendor`), `synth.html` (17, the standalone synth page).

## Scale summary

~15k added lines across 83 files. The bulk is the six sense modules (~6k) and the
vendored synth (~5k). The genuinely *architectural* new code — `senses/ids.ts`,
`senses/director.ts`, the registry `sense`/`senseAuthority` block, and the Theatre
bridge/envelopes — is small (a few hundred lines) but is what makes the whole thing
hang together cleanly.
