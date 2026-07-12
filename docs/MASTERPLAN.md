# Masterplan — Integration der Sinnes-Module

**Stand: 2026-07-11 · wird nach jedem Arbeitsschritt aktualisiert (Status-Spalte + §6).**

Becoming Many ist eine interaktive Flugexperience, in der nichtmenschliche Wahrnehmungsformen
Stück für Stück freigeschaltet und übereinandergelegt werden. Dieser Plan beschreibt, wie die
sieben Designer-Prototypen (aktuell provisorisch im Hauptordner) in das bestehende Framework
(Vite + strict TS, three r185 WebGPU/TSL, Signal-Substrat, Clock-Spine, Theatre.js) integriert
werden.

---

## 1. Modulübersicht

| # | Prototyp-Ordner | Inhalt | Tech | Zielort in `src/` |
|---|---|---|---|---|
| A | `ShaderSinneModul` | **4 eigenständige Sinne** (Wahrnehmbare Farben, Echoortung, Infrarot, UV-Reflexion) + Kompositor (`SenseSystem`), Blend-Modi, `SenseSurface`-Vertrag, UI-Deskriptoren (`senseControls`), Serialisierung | TSL/WebGPU, JS | `src/senses/shader/` |
| B | `ChemischeWahrnemungExperiment` | Duft-Sinn: GPU-Luftfeld (bis 1 M Partikel, TSL-Compute), Wind/Böen/Turbulenz, Duftzonen mit Aufnahme + Verflüchtigung, räumliches Gitter, Kompaktierung | TSL/WebGPU, JS | `src/senses/duft/` |
| C | `MagnetfeldwahnehmungExperiment1` | Magnetfeld-Sinn: Himmel-Shader mit 9 mischbaren Modi (Aurora, Feldlinien, Vogel-Noise, Spektrum, Eisenspäne, Moiré, Plasma, Polar, …), Feldachse (Deklination/Elevation), alles Uniforms | TSL/WebGPU, JS | `src/senses/magnetfeld/` |
| D | `swarm_network` | Netzwerk-Sinn: `SwarmNetwork` (Verbindungsröhren + Glow + Signalpartikel zwischen beweglichen Objekten) und `MyceliumNetwork` (Myzel-Linien, Hotspots, verzweigte Arme) | three, JS, **GLSL-ShaderMaterial** | `src/senses/netzwerk/` |
| E | `vogel_motion_sinn` | Motion-Sinn: Partikel-Trails aus animierten Vertices (`createMotionParticleEffect`, `AnimatedVertexSampler`, `ParticleTrailBuffer`, Emissionsprofile, Target-Adapter) | three, JS (bereits als Modul refaktoriert) | `src/senses/motion/` |
| F | `360_sinn_modul` | Rundum-Sinn: `LittlePlanetRenderer` — Szene in Cubemap capturen, Little-Planet-Projektion als Fullscreen-Pass | three, JS, **GLSL-ShaderMaterial + WebGLCubeRenderTarget** | `src/senses/rundum/` |
| G | `SynthModulHandy` | Synthesizer: Tone.js-Engine, 8 Klang-Sinne × 3–6 Varianten (`senses/registry.js`), Layer-/Stimmen-System, Mapping-Backend (`FlightMap`), räumliches Hören, Rack-UI mit Patch-Kabeln | Tone 14.8.49, JS + eigenes CSS | `src/synth/` (vendored, UI bleibt) |

**Nicht übernommen** (Demo-/Testumgebungen): alle Demo-Welten (`ShaderSinneModul/src/world`,
`ChemischeWahrnemung/src/world.js`+`main.js`, Magnetfeld-Terrain/Bäume/Gras in `main.js`,
`swarm_network/demo`+`vendor`, `vogel_motion_sinn/demo`, `SynthModulHandy/src/flight/world.js`),
alle Prototyp-UIs außer der Synth-UI (`ShaderSinneModul/src/ui`, lil-gui-Devtools), eigene
Renderer/Kamera/Loops/HTTP-Configs, `SynthModulHandy/5/` (eingefrorener Altstand), `dist/`.

---

## 2. Verwendungszweck in Becoming Many

| Sinn (SenseId) | Quelle | Zweck in der Experience |
|---|---|---|
| `farben` | A | Das normale sichtbare Farbbild — deckt die weiße Basiswelt auf (Helligkeit/Sättigung/Gamma/Schattierung) |
| `echo` | A | Fledermaus-Echoortung: Distanz→Helligkeit, Sonar-Ringe, wandernder Ping |
| `infrarot` | A | Wärmebild: Terrain-Temperatur über Kelvin-Fenster + 4-Stop-Palette |
| `uv` | A | UV-Reflexion: enthüllt organische UV-Signale (Nektarmale, Flechten) auf Oberflächen |
| `duft` | B | Chemische Wahrnehmung: sichtbare Duftfahnen im Wind über dem Terrain |
| `netzwerk` | D | Kollektiv-Wahrnehmung: leuchtendes Kommunikationsnetz zwischen Schwarm-Kreaturen + Myzel im Boden |
| `motion` | E | Bewegungssehen: nur Bewegung ist sichtbar — Partikel-Trails der Schwarmtiere statt Meshes |
| `magnetfeld` | C | Magnetrezeption: der Himmel zeigt das Erdmagnetfeld (9 Visualisierungs-Modi, mischbar) |
| `rundum` | F | 360°-Wahrnehmung: Little-Planet-Rundumblick als alternative Kameraprojektion |
| Synth | G | Jede visuelle Ebene bekommt eine Klang-Ebene; Sounddesign läuft weiter über die erhaltene Synth-UI |

Mapping Synth-Klang-Sinne ↔ visuelle Sinne (Vorbelegung, im Code als eine Konstante änderbar):
`echo→echo`, `uv→licht`, `duft→chemie`, `magnetfeld→magnet`, `motion→motion`,
`netzwerk→rhythmus`, `rundum→sicht`, `farben→luft`. (`infrarot` hat noch keine eigene
Synth-Entsprechung — offene Sounddesign-Frage, s. §6.)

---

## 3. Zu übernehmende Funktionen & Parameter

### A — ShaderSinneModul (4 Sinne!)
- **Übernehmen:** kompletter `src/core/` (Sinnes-Fabriken `createFarben/-Echolocation/-Infrared/-UV`
  mit allen Params + UI-Metadaten, `SenseSystem`-Kompositor mit `enabled/opacity/range/rangeSoft`
  pro Sinn, 8 Blend-Modi, `normalizeSurface`/`SenseSurface`, `uvSignals` (nectarGuide,
  lichenBlotches, foliageSheen), `senseControls`-Deskriptoren, `paramTree` dump/load,
  Serialisierung `becoming-many-senses`).
- **Anpassen:** Port nach strict TS; `uTime` an die Clock (Spine) statt eigener Zeit;
  `uBaseColor`-Basis bleibt; Kompositor-Ausgabe wird in das **Terrain-Material** eingebaut
  (Terrain = `SenseSurface`: `albedo` = Biome-Vertexfarbe, `tempK` prozedural aus Höhe/Hang/Wasser,
  `uvSignal` aus Biome + `lichenBlotches`); Aktivierung läuft über Sense-Signale statt direktem
  UI-Zugriff.
- **Weglassen:** Demo-Welt, Demo-Panel, eigener Renderer/Loop.

### B — Chemische Wahrnehmung
- **Übernehmen:** `ScentField` (kompletter TSL-Compute: Advektion, Böen, Turbulenz inkl.
  Billig-Variante, Aufnahme/Verflüchtigung, Gitter-Beschleunigung, Reseed, Kompaktierung,
  Fern-Culling, Winkelgrößen-Deckel), alle `params.js`-Uniforms (Wind ×9, Partikel/Duft ×8,
  Performance ×4, `typeIntensity` je Dufttyp), `SCENT_TYPES` (5 Dufttypen + Farben).
- **Anpassen:** Port nach TS; Duftzonen kommen nicht mehr aus der Demo-Wiese, sondern werden
  **prozedural aufs Terrain gestreut** (Biome-/Höhen-abhängig, um den Player verankert,
  Re-Anchor beim Weiterflug); Zeit über die Clock (`timeScale` folgt dem Spine); Sichtbarkeit
  über das `duft`-Sense-Signal.
- **Weglassen:** weiße Demo-Pflanzenwelt, lil-gui-Devtool, `window.duftwiese`, eigener Loop.

### C — Magnetfeld
- **Übernehmen:** `sky.js` vollständig (Feldachse `decl`/`elev`, `weights[9]`,
  alle `modeU`-Parameter inkl. Farben, `createSkyMaterial`).
- **Anpassen:** Port nach TS; Imports `three` → `three/webgpu`; Sky-Dome-Mesh (große Kugel,
  am Player zentriert) statt Demo-Szene; Gesamtsichtbarkeit über das `magnetfeld`-Signal
  (Master-Opacity/Mix gegen den bestehenden Himmel); Modi-Gewichte + Parameter in die
  gemeinsame Sinne-UI.
- **Weglassen:** komplettes `main.js` (Demo-Terrain, Bäume, Gras, Felsen, Kamera, lil-gui).

### D — Schwarm-Netzwerk
- **Übernehmen:** `SwarmNetwork` (Optionen: maxNodes, nearestLinks, linkSegments, Radien,
  Farben, signalSpeed/-Travel/-Size, networkIntensity, curveStrength) und `MyceliumNetwork`
  (radius, neighbourLinks, radialArms, branchDepth, Farben, Hotspot-Parameter),
  `objectAdapters`, `utils`.
- **Anpassen:** Port nach TS + `three/webgpu`; die zwei **GLSL-ShaderMaterials → TSL-Node-
  Materials** (Signalpartikel-Points, Myzel-Linien); Knoten kommen aus dem neuen
  Kreaturen-Substrat (§4 S7): Vogelschwarm = Swarm-Knoten, Pilz-Spawns = Myzel-Knoten;
  Sichtbarkeit/Intensität über das `netzwerk`-Signal.
- **Weglassen:** Demo (`demo/`, `vendor/three.module.js`, Kugeln/Pilz-Platzhalter).

### E — Vogel-Motion
- **Übernehmen:** komplettes `module/` unverändert in der Struktur (bereits sauber
  refaktoriert): Effekt-Fabrik, Vertex-Sampler (inkl. SkinnedMesh-Bones), Ring-Buffer mit
  Lifetime/Fade/Expansion, Emissionsprofile, Target-Adapter, Sichtbarkeits-Empfehlungen.
- **Anpassen:** Port nach TS; Targets = Vogelschwarm aus dem Kreaturen-Substrat (prozedural
  animierte Flügel — kein GLB im Repo); `setEnabled` über das `motion`-Signal (Quell-Meshes
  verstecken übernimmt der Host laut Empfehlungs-API); Update in der Frame-Loop.
- **Weglassen:** Svelte-Demo-Routen, Lab-Referenz.

### F — 360 / Little Planet
- **Übernehmen:** `LittlePlanetRenderer`-Konzept + alle Optionen (`cubeSize, near, far, zoom,
  yawOffset, exposure, contrast, vignette, centerLift`), Render-Ablauf (CubeCamera capture →
  Fullscreen-Projektion, hiddenObjects, Yaw aus Kamera-Forward).
- **Anpassen:** Port nach TS; **GLSL-Fragment-Shader → TSL** (`cubeTexture`-Node), Cube-Target
  über den WebGPU-Pfad; Einbindung als **View-Mode** (exklusiv, kein Layer): aktiviert über das
  `rundum`-Signal, ersetzt den normalen `renderer.render`-Pass.
- **Weglassen:** nichts weiter (Modul ist bereits kernig); `types.d.ts` entfällt durch TS-Port.

### G — Synthesizer (UI/UX bleibt!)
- **Übernehmen:** alles außer der Demo-Flugwelt: `core/` (Engine, SenseLayer, 4 Stimmen,
  SpatialAudio), `senses/registry.js` (**heilig** — 8 Sinne × Varianten, nur unangetastet
  vendoren), `ui/` (App, Rack, Karten, Knobs, PadViz, Master, LFO/Drift, Settings),
  `patch/` (Kabel, Buchsen, Popover), `flight/mapping.js` (`FlightMap`) + `flight/sheet.js`,
  Styles. Tone **fest 14.8.49**.
- **Anpassen:** als vendored JS-Paket unter `src/synth/` (eigene `.d.ts`-Fassade; von den
  strict-Gates ausgenommen — Begründung §4); Overlay-Einbindung in die Hauptseite (Taste,
  Vollbild-Drawer, Audio-Unlock-Schleier bleibt); das Demo-Modul `flight/world.js`+`module.js`
  wird durch ein **Signal-Quellen-Modul** ersetzt: liefert `params` (0..1: Höhe, Tempo,
  Pitch/Roll, controlQuality, unrest, intensity, senseIntensitäten …) und `pose`/`anchors`
  aus dem Signal-Substrat in den bestehenden Mapping-/Spatial-Weg; Sense-Signale aktivieren
  die zugehörigen Synth-Layer (Mapping §2).
- **Weglassen:** `flight/world.js` (Demo-3D-Welt), `flight/module.js` (Demo-Karte; wird durch
  die Signal-Quellen-Karte ersetzt), `5/`, `dist/`, eigenes Vite-Setup.

---

## 4. Architektur, Signale & Schnittstellen

**Grundgesetz bleibt:** ein Zeit-Spine (Clock), Signale als einziges geteiltes Substrat,
Bus für Momente, One-Writer-Law, `peek()` im Hot-Path. Neu dazu kommt die **gelayerte
Sinnes-Steuerung** (das bisherige exklusive `activeSense` wird abgelöst):

```
                    Theatre 'Timeline' (5 min)  ──┐ (authored envelopes, je Sinn 0..1)
                                                  ├─► pumpAuthored ──┐   nur wenn senseAuthority == 'theatre'
  Sinne-UI / Tasten 1–9 ── bus 'sense:set' ──► SenseDirector ────────┴─► signals.sense[id]  (0..1, EIN Writer)
                                                                             │ subscribe (coarse)
        ┌──────────────┬──────────────┬───────────────┬────────────────┬────┴─────────┐
   shader-Sinne     duft (Partikel)  netzwerk      motion (Trails)  magnetfeld     synth-Bridge
   (Terrain-Layer)  ScentField       Swarm+Myzel   Vogel-Vertices   Sky-Dome       (Tone-Layer an/aus)
```

- **`signals.sense`** — pro SenseId ein `Signal<number>` (Intensität 0..1; 0 = aus). Einziger
  Writer ist der **SenseDirector** (`src/senses/director.ts`): er empfängt Bus-Kommandos
  (`sense:set {id, value}`, `sense:toggle {id}`) und — im Theatre-Modus — die authored
  Envelope-Werte aus `pumpAuthored`. Manuelle Steuerung und Theatre benutzen damit
  **dieselben Signale**; `signals.senseAuthority` (`'manual' | 'theatre'`, Writer: UI)
  entscheidet, wer gerade schreibt.
- **Kommandos in Module hinein** laufen über den Bus (`sense:set`, `sense:param
  {id, key, value}`, `cue:*`); **Zustand aus Modulen heraus** über Signale
  (`signals.sense[id]`, `playerPose`, `time`, `unrest`, `intensity`, `controlQuality`).
  Module kennen einander nicht; `main.ts` bleibt Kompositionswurzel.
- **Theatre.js** steuert eine ~**300 s**-Timeline: je Sinn ein `types.number(0..1)`-Envelope
  (+ weiter `unrest`/`intensity`), Events/Cues über `bus.when`-Schwellen auf authored Signalen.
  Die alte Flugbahn-Aufnahme/-Wiedergabe entfällt (Flug ist ausschließlich Player-gesteuert;
  es gab ohnehin nur den `Camera`-Sheet-Stub — wird nicht weiterverfolgt).
- **Gemeinsame Sinne-UI** (`src/dev-console/sense-controls.ts`): eine Sektion in der
  C-Konsole nach dem Muster von `world-controls.ts`; pro Sinn eine aufklappbare Karte
  (Toggle, Intensität, sinnspezifische Regler aus den `senseControls`-Deskriptoren des
  ShaderSinne-Kerns bzw. gleichartigen Deskriptoren der anderen Module). Schreibt
  ausschließlich Bus-Kommandos. Authority-Schalter Theatre/Manuell. Layering testbar
  (mehrere Toggles gleichzeitig, Reihenfolge/Blend für Shader-Sinne).
- **Synth-Ausnahme:** UI/UX des Synths bleibt vollständig erhalten (eigene Karten, Kabel,
  Themes) — nur seine *Quellen* (früher Demo-Flug) kommen jetzt aus dem Signal-Substrat, und
  seine Layer-Aktivierung hört auf `signals.sense[id]`.
- **Strict-Gates:** alle portierten Sinnes-Kerne werden strict-TS-sauber. Ausnahme ist der
  vendorte Synth (`src/synth/vendor/**`, ~4 800 Zeilen Designer-JS, dessen UI/UX bewusst
  unverändert weiterlebt): er wird über eine typisierte `.d.ts`-Fassade angesprochen, vom
  `tsc`-Include ausgenommen und in Biome ignoriert. Die Prototyp-Ordner im Root werden bis zu
  ihrer Löschung ebenfalls von Biome ignoriert.

**Neues Host-Substrat `src/creatures/`** (Voraussetzung für D + E): Boids-Vogelschwarm mit
prozedural animierten Flügeln (SkinnedMesh/rotierenden Flügel-Meshes, terrainbewusst, um den
Player) + Pilz-Spawnpunkte auf dem Terrain. Wird von `netzwerk` (Knoten) und `motion`
(Vertex-Quellen) gelesen; Sichtbarkeit der Vogel-Meshes folgt den Empfehlungen des
Motion-Moduls.

---

## 5. Integrationsreihenfolge (jeder Schritt lässt die App lauffähig)

| Schritt | Inhalt | Status |
|---|---|---|
| S0 | Vorbereitung: Biome-Ignores für Prototyp-Ordner, Masterplan | ✅ fertig |
| S1 | Signal-Substrat erweitern: SenseIds, `signals.sense[id]`, `senseAuthority`, Bus-Konventionen, SenseDirector, Tasten 1–9 = Layer-Toggles (ersetzt exklusives Umschalten) | ✅ fertig |
| S2 | ShaderSinne-Kern portieren + Terrain als `SenseSurface` (farben/echo/infrarot/uv sichtbar auf dem Terrain, Signal-gekoppelt) | ✅ fertig |
| S3 | Gemeinsame Sinne-UI in der C-Konsole (Karten aus Deskriptoren, Layering-Test, Authority-Schalter) | ✅ fertig |
| S4 | Theatre: 300 s-Timeline, je Sinn ein Envelope, `pumpAuthored`-Erweiterung, Timeline-Länge in `state.json` | ✅ fertig |
| S5 | Magnetfeld-Sky portieren (Dome, 9 Modi, UI-Sektion, Signal) | ✅ fertig |
| S6 | Duft portieren (ScentField, prozedurale Terrain-Duftzonen, Re-Anchor, UI, Signal) | ✅ fertig |
| S7 | Kreaturen-Substrat: Boids-Vogelschwarm + Pilz-Spawns | ✅ fertig |
| S8 | Netzwerk portieren (TSL-Ports der Shader, Knoten aus S7, UI, Signal) | ✅ fertig |
| S9 | Motion-Partikel portieren (Targets aus S7, UI, Signal) | ✅ fertig |
| S10 | Rundum/Little-Planet portieren (TSL/WebGPU-Port, View-Mode, UI, Signal) | ✅ fertig |
| S11 | Synth integrieren (vendoren, Overlay, Signal-Quellen-Modul, Layer-Kopplung, Tone-Dependency) | ✅ fertig |
| S12 | Feinschliff: Sense-Cues auf dem Bus, Doku (AGENT.md), Gates + Build + Runtime-Smoke-Test, Masterplan-Abschluss | ✅ fertig |

Begründung der Reihenfolge: erst das Steuer-Rückgrat (S1) und der größte visuelle Träger
(S2, Terrain), dann die UI, mit der sich alles Weitere testen lässt (S3), dann Theatre als
zweiter Schreiber derselben Signale (S4). Danach die eigenständigen Welt-Ebenen in wachsender
Abhängigkeit (S5 ohne Abhängigkeiten → S6 Terrain-abhängig → S7/S8/S9 Kreaturen-Kette →
S10 Render-Pfad). Der Synth kommt zuletzt (S11), weil er alle Sense-Signale konsumiert.

---

## 6. Status & offene Aufgaben

**Erledigt:**
- Analyse aller Module + Framework, Masterplan (dieses Dokument).
- S0: Biome ignoriert die Prototyp-Ordner; beide Gates grün.
- S1: `src/senses/ids.ts` (9 SenseIds + Labels + Synth-Mapping), `signals.sense[id]` +
  `senseAuthority` + dominantes `activeSense` im Registry, `src/senses/director.ts`
  (Bus-Kommandos `sense:set/toggle/solo/clear` → Signale, `sense:changed`-Mirror,
  manuelle Kommandos flippen Authority auf `manual`), Tasten 1–9/0 emittieren Bus-Kommandos,
  Atmosphäre (Fog/Reveal/Rim) folgt dem dominanten Sinn — und die Atmosphären-Uniforms der
  Senses werden jetzt wirklich ans Terrain durchgereicht (vorher zwei getrennte Uniform-Sets).
- S2: ShaderSinne-Kern portiert nach `src/senses/shader/` (strict TS): 4 Sinnes-Module,
  `SenseSystem`-Kompositor, 8 Blend-Modi, `SenseSurface`+`normalizeSurface`, `uvSignals`,
  `senseControls`-Deskriptoren, Serialisierung. Farb-Uniforms werden per `.rgb` zu vec3
  normalisiert (statt `as`-Casts). Terrain-Material komponiert die Layer über die
  Biome-Albedo (`tempK` prozedural: Sonnenhänge warm, Höhe kühlt; `uvSignal` =
  Flechten-Blotches auf Steilhängen); Struktur-Änderungen (Blend/Reihenfolge) triggern
  `rewire()` des geteilten Materials. `signals.sense[id]` wird pro Frame weich in die
  `enabled`-Uniforms geeast (2,5 s); `uTime` folgt dem Clock-Spine. Build grün.
- S3: Gemeinsame Sinne-UI `src/dev-console/sense-controls.ts` in der C-Konsole: eine Karte
  je Sinn (Toggle/Solo/Intensität + Modul-Parameter aus Deskriptoren, Blend + Reihenfolge
  für Shader-Sinne), Authority-Schalter Manuell/Theatre, „Alle aus". Alle Aktionen sind
  Bus-Kommandos (`sense:set/toggle/solo/clear/param/blend/move`); die Shader-Fassade
  routet `sense:param`-Kommandos auf ihre Uniforms. Signal-Änderungen von außen (Tasten,
  Theatre) spiegeln sich live in den Karten.
- S4: Theatre-Timeline: `arc`-Objekt trägt jetzt `unrest`/`intensity` + ein
  `senses`-Compound mit 9 Envelopes (0..1 je Sinn); `state.json` pinnt die
  Sequenzlänge auf 300 s; `pumpAuthored` schreibt die Sense-Signale nur bei
  `senseAuthority == "theatre"`. Der ungenutzte 'Camera'-Sheet-Stub (Flugbahn-Idee)
  wurde entfernt — der Flug bleibt ausschließlich Player-gesteuert.
- S5: Magnetfeld nach `src/senses/magnetfeld/` portiert: alle 9 Sky-Modi in einem
  TSL-Material (Gewichts-Mix, keine Recompiles), Feldachse + sämtliche Modus-Parameter
  als Uniforms; TSL-`time` → `uSkyTime` (Clock-Spine), neues `uVisibility` als
  Opacity-Fade (3 s) am Sense-Signal; Dome (r=900) folgt dem Player und wird bei 0
  komplett unsichtbar geschaltet. Volle Parameter-Oberfläche (~90 Regler inkl. Farben)
  als UI-Deskriptor; `sense:param`-Routing über `weight.<mode>` / `<mode>.<param>` /
  `declDeg`/`elevDeg`. Env-Licht/Nebel-Presets der Demo entfallen (Atmosphäre kommt
  vom Sense-Profil).
- S6: Duft nach `src/senses/duft/` portiert: kompletter TSL-Compute (Advektion, Böen,
  billige+volle Turbulenz, Aufnahme/Verflüchtigung, Zonen-Gitter, Reseed, Kompaktierung,
  Fern-Culling, Winkelgrößen-Deckel). Neu: Feld simuliert in **lokalen Koordinaten um
  einen versetzbaren Anker** — `setZones`/`setCenter` schreiben Zonen- und Gitter-Buffer
  in place (kein Pipeline-Rebuild beim Weiterflug, Re-Anchor bei ~96 m); Duftzonen
  werden prozedural höhen-/hangabhängig aufs Terrain gestreut (Blumen/Lavendel flach,
  Kräuter/Baumkronen-Blobs mittig, Kiefern hoch); `u.delta`/`u.time` folgen dem Spine;
  `u.fade` (Sense-Signal) gated Opacity UND Compute (0 = keine GPU-Kosten). Volle
  Dev-Tool-Parameter als UI-Deskriptor; `typeIntensity` als Storage-Buffer.
- S7: `src/creatures/` — Boids-Vogelschwarm (28 Vögel, Körper + 2 Flügel-Meshes mit
  prozeduralem Flügelschlag, Separation/Alignment/Kohäsion, weiche Player-Leine,
  Terrain-Boden/Deckel) und 24 Pilz-Spawns am Terrain (Re-Anchor bei ~110 m,
  `creatures:mushrooms-changed`-Event auf dem Bus). `setBirdsVisible()` für die
  Motion-Sinn-Empfehlungen.
- S8: Netzwerk nach `src/senses/netzwerk/` portiert: SwarmNetwork (Röhren + Glow als
  InstancedMesh mit NodeMaterials; Signalpartikel: GLSL-Points → instanzierte
  TSL-Sprites, da WebGPU keine skalierbaren Points hat) + MyceliumNetwork
  (GLSL-Linien-Shader → `LineBasicNodeMaterial`-Nodegraph, Klammer um den
  Pilz-Zentroid statt Weltursprung). Knoten = Vögel, Myzel = Pilze (Rebuild auf
  `creatures:mushrooms-changed`); `fade`-Uniform am Sense-Signal (unsichtbar = 0 Kosten);
  Optionen typisiert über `sense:param` (`swarm.<key>` / `myzel.<key>`).
- S9: Motion nach `src/senses/motion/` portiert (Sampler mit Root-Space-Sampling +
  Bone-Support, Emissionsprofile, Target-Adapter mit Sichtbarkeits-Empfehlungen,
  Ring-Buffer). `THREE.Points` → instanzierte TSL-Sprites (WebGPU-Points sind 1 px);
  Fade-out nach Deaktivierung ist auf eine Lifetime begrenzt (der Prototyp-Ringbuffer
  ließ Partikel nach dem Wrap wieder aufleuchten). Vögel verstecken sich bei aktivem
  Sinn (Empfehlungs-API, Host wendet an).
- S10: Rundum nach `src/senses/rundum/` portiert: `CubeRenderTarget` (WebGPU-Variante) +
  CubeCamera-Capture, GLSL-Fullscreen-Shader → TSL (`cubeTexture`-Node, Yaw-Rotation,
  Exposure/Kontrast/Vignette als Live-Uniforms). Neuer Renderer-Hook
  `setRenderOverride()` ersetzt den Render-Pass solange das Signal an ist (in XR
  übersprungen). near/far werden auf die 6 Kind-Kameras der CubeCamera geschrieben
  (das Prototyp-Setzen auf der CubeCamera selbst war wirkungslos).
- S11: Synth integriert. Der Designer-Code liegt UNVERÄNDERT (UI/UX/Kabel/Rezepte) als
  vendored App unter `src/synth/vendor/` (Tone fest 14.8.49, Biome-ignoriert, für tsc
  unsichtbar) und läuft auf einer eigenen Seite `synth.html` — weiterhin standalone
  auf dem Handy nutzbar ODER in der Experience als iframe-Overlay (Taste **M**,
  `src/synth/index.ts`). Die Bridge pusht pro Frame `window.__bmFrame` (Pose fürs
  räumliche Hören, 6 Flugwerte aus dem emergenten Zustand, 9 Sinnes-Intensitäten +
  unrest/intensity/quality, Anker: Schwarm-Zentroid + Pilze) und fügt beim ersten
  Anstieg eines Sinnes einmalig den gemappten Synth-Layer hinzu (Deaktivieren
  entfernt nie — Sounddesign-Hoheit bleibt in der Synth-UI). Einzige Vendor-Edits
  (dokumentiert): Demo-Flugwelt/-Karte → Signal-Quellen-Karte (gleiche Buchsen +
  neue Sinnes-Quellen), `mapping.js` + `SENSE_QUELLEN`, `app.js` mischt
  `__bmFrame.senses` in den Live-Mix. Audio-Unlock bleibt der Original-Schleier.
- S12: `cue:sense:<id>`-Events feuern auf der steigenden Flanke jedes Sense-Signals
  (Platzhalter-Cues im SoundDirector, inert bis Audio-Assets da sind); AGENT.md um
  die Layer-/Signal-/Synth-Architektur ergänzt; Gates grün (`typecheck`, `check`,
  `build`); Headless-Chrome-Smoke-Test: Hauptseite bootet ohne App-Fehler (9
  Sinnes-Karten im Panel, Synth-Tab, Dev-Konsole), `synth.html` lädt Tone + Schleier
  korrekt (AudioContext wartet regulär auf die Geste).

**Offen / Folgearbeiten (nach dieser Integration):**
- Sounddesign: Zuordnung `infrarot` → Synth-Sinn klären (aktuell unbelegt); echte
  Audio-Assets für `SoundDirector`-Cues.
- Dramaturgie: die 5-min-Timeline in Studio ausarbeiten und `state.json` exportieren
  (aktuell nur Beispiel-Keyframes).
- Duftzonen an echte Vegetation koppeln, sobald es Pflanzen-Assets gibt (derzeit
  biome-gewichtete Streuung).
- Prototyp-Ordner im Root löschen, sobald das Team sie nicht mehr als Referenz braucht.
- VR-Pfad des Rundum-Sinns (im XR-Modus wird der Little-Planet-Pass übersprungen).
