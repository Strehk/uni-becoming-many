# Becoming Many

Eine spekulative VR-Experience über kollektive Wahrnehmung, ökologische Verbundenheit und die
Frage, wie Realität überhaupt entsteht. Man fliegt als Gleiter durch eine zunächst weiße, fast
leere Welt und erweitert die eigene Wahrnehmung Schritt für Schritt durch die Sinnessysteme
anderer Lebensformen — Echoortung, Bewegungssehen, UV, Thermalsicht, chemische Wahrnehmung,
Magnetfeldsinn, Schwarm-Netzwerk, 360°-Rundumblick. Die Sinne werden **gelayert, nicht ersetzt**:
Die Welt wird mit jeder Ebene dichter, bis sie in Phase 3 bewusst überfordert und die Layer
Schicht für Schicht wieder abgetragen werden, bis nur noch der Wind bleibt.

Laufzeit ca. 5 Minuten, drei Phasen (Discovery → Realisation → Overload), Voiceover + wachsende
Klangebene. Technisch: Vite 6 + strict TypeScript, three.js r185 auf **WebGPU/TSL**, WebXR,
Theatre.js als Timeline, Tone.js-Synth als eigene Seite/Overlay.

**Hintergrund, Konzept, Storyboard und Skript:**
[Notion — Becoming Many](https://futurerealiteslab.notion.site/Becoming-Many-34b29d8a9fe280ceb963f133aa2689ee)
· Technische Detaildoku: [`AGENT.md`](AGENT.md) und [`docs/`](docs/)

---

## Voraussetzungen

| | |
|---|---|
| **Bun** | ≥ 1.2 (entwickelt mit 1.3.x) — Paketmanager **und** Script-Runner. npm/yarn/pnpm werden nicht verwendet (`bun.lock` ist die Quelle der Wahrheit). |
| **Browser mit WebGPU** | Chrome/Edge ≥ 113 oder Safari ≥ 26 auf aktuellem macOS. Der Renderer importiert ausschließlich `three/webgpu` — ohne WebGPU bleibt der Canvas schwarz, es gibt keinen WebGL-Fallback. |
| **GPU** | Alles läuft als GPU-Compute (Gras, Duftfeld, Partikel, Terrain-Streaming). Integrierte Chips funktionieren, Apple Silicon / dedizierte GPU wird empfohlen. |
| **Git** | Repo enthält die Assets direkt (kein Git LFS): ca. 25 MB `assets/` (FBX-Quellen) + 10 MB `public/` (GLB, Audio). |
| *optional* **VR-Headset** | Meta Quest o. ä. mit WebXR-fähigem Browser, im selben LAN wie der Dev-Rechner. |
| *optional* **M5-Controller** | M5StickC Plus2 am Flugrig. Die Bridge in `bridge/` spricht ihn direkt an — kein externer Host mehr. Ohne Controller läuft alles auf Tastatursteuerung. |

Node.js wird nicht gebraucht — die Scripts in `scripts/` laufen unter Bun.

---

## Setup

```bash
git clone git@github.com:Strehk/uni-becoming-many.git becoming-many
cd becoming-many
bun install
bun run dev
```

`bun run dev` startet `vite --host` und gibt die URL im Terminal aus — normalerweise
`https://localhost:5173/`, bei belegtem Port aber 5174/5175/…, also **die Adresse aus dem
Vite-Banner lesen**, nicht raten.

### HTTPS ist Pflicht, nicht Kür

Der Dev-Server läuft über HTTPS (`vite-plugin-mkcert`), weil WebXR nur in einem Secure Context
startet. Beim ersten Start legt das Plugin lokal vertrauenswürdige Zertifikate unter
`~/.vite-plugin-mkcert/` an; macOS fragt dabei einmalig nach dem Passwort, um das Root-Zertifikat
in den Schlüsselbund zu legen. Auf anderen Geräten im LAN (Headset, Handy) ist das Zertifikat
nicht bekannt — dort muss die Browserwarnung einmal manuell akzeptiert werden.

### Qualitäts-Gates

Alle Gates müssen sauber durchlaufen, bevor Code als fertig gilt. `bun test` ist der
bun-eigene Runner (kein Setup nötig) und deckt gezielt die M5-Control-Pipeline ab — dort steckt
Domänenwissen über das physische Rig, das man nicht still kaputtrefactoren will:

```bash
bun run typecheck   # tsc --noEmit (sehr strikter Modus, siehe AGENT.md)
bun run check       # biome check --write .  (Format + Lint + Autofix)
bun test            # bun-eigener Runner; deckt die M5-Control-Pipeline ab
bun run build       # tsc && vite build -> dist/   ← das eigentliche Gate
bun run preview     # den Production-Build ausliefern
```

Ein Build-Fehler ist fast immer ein Typfehler, kein Bundling-Fehler.

---

## Start-Varianten

```bash
bun run dev                # HTTPS-Dev-Server + M5-Bridge, im LAN erreichbar (--host)
bun scripts/m5-sim.ts      # simulierter Controller — Fliegen ohne Hardware
bun run serve              # Produktions-Server (liefert dist/ + Bridge), siehe Deployment
```

`bun run dev` startet den Dev-Server **und** die Controller-Bridge im selben Prozess. Es gibt
keine Host-Adresse mehr zu konfigurieren: der Controller-Stream läuft über die eigene Origin
(`wss://<dev-url>/ws/m5`). Details in [`docs/m5-bridge.md`](docs/m5-bridge.md).

**Query-Parameter** der Hauptseite:

| Parameter | Wirkung |
|---|---|
| `?studio=1` | Theatre.js **Studio** laden (Timeline-Authoring). Überspringt das Start-Menü, die Uhr läuft. |
| `?debug=1` | Dev-Overlays bleiben nach dem Start sichtbar. |

**Seiten:** `/` (Experience) · `/pair.html` (Controller einrichten) · `/synth.html` (Synth).

---

## Bedienung

### Ablauf

1. **Start-Menü** (erscheint automatisch, außer bei `?studio=1`):
   - *Experience starten* — Playback-Modus, UI verschwindet.
   - *Experience konfigurieren* — Dauer, Sinn-Freischaltungen, Startzeiten, Intensitäten;
     dazu *Test ansehen*, *Export/Import JSON*, *Theatre Timeline öffnen*. Die Konfiguration
     liegt im `localStorage`.
2. Nach *starten* steht die Zeitachse bei t=0 still (**Start-Gate**) — das Publikum löst selbst
   aus: **Knopf am M5**, **Enter** auf der Tastatur oder **A** am XR-Controller. Auf der Maschine
   liegend ist der M5-Knopf der einzige erreichbare davon.
3. Danach läuft die authored Theatre-Timeline (~300 s) und schaltet die Sinne nach Plan frei.

### Tasten

| Taste | Funktion |
|---|---|
| `W`/`S` bzw. ↑/↓ | Nase hoch / runter (Höhe). Der Flug ist ein Gleiter mit konstantem Vortrieb. |
| `A`/`D` bzw. ←/→ | Kurve links / rechts |
| `Shift` | 2× Fluggeschwindigkeit |
| `Enter` | Start-Gate auslösen (Timeline beginnt) |
| `Space` / `K` | Zeit-Spine pausieren / weiterlaufen |
| `J` / `L` | zurück- / vorspulen |
| `,` / `.` | Zeitraffer halbieren / verdoppeln |
| `Home` | Uhr auf 0 zurücksetzen |
| `C` | Dev-Konsole (FPS/Stats, Sinne, Welt, Flora & Fauna, Events, Minimap) |
| `M` | Synth-Overlay (Tone.js-Drone-Organ im iframe) |
| `Enter VR` | Button unten rechts — startet die WebXR-Session |

Sinne werden zur Laufzeit über das **Sinne-Panel** in der Dev-Konsole (`C`) geschaltet: pro Layer
*An/Aus*, *Solo*, Intensitäts-Slider, plus alle Modulparameter. Jede manuelle Aktion setzt
`senseAuthority` auf `"manual"`, damit die laufende Theatre-Timeline die Werte nicht wieder
überschreibt; über *Theatre* im selben Panel gibt man die Hoheit zurück.

### Die weiße Leere ist Absicht

Ohne aktiven Sinn muss die Welt **unsichtbar** sein — ein gleichmäßiges helles Feld ohne Terrainform
und ohne Kreaturen. Ein Screenshot ohne aktiven Sinn zeigt deshalb korrekterweise nur Weiß. Wer neue
Weltobjekte hinzufügt, muss sie an ein Sinnessignal koppeln, sonst bricht die Grundsituation.

---

## VR im LAN

1. Dev-Rechner und Headset ins selbe Netz.
2. `bun run dev` — dank `--host` liefert Vite auch eine LAN-URL
   (`https://192.168.x.x:5173/`) im Banner.
3. Diese URL im Headset-Browser öffnen, Zertifikatswarnung akzeptieren.
4. *Enter VR* drücken. Die Session fordert das `webgpu`-Feature an, der Browser im Headset muss
   WebGPU also aktiv haben.

In VR schreibt das Headset die Kamerapose innerhalb des Rigs — geflogen wird immer das **Rig**,
nie die Kamera direkt, damit Flug und Kopftracking sich sauber überlagern.

## M5-Controller

Dieses Repo spricht selbst mit dem Controller — es gibt keinen separaten Host mehr. `bridge/`
nimmt die Frames des M5 auf `ws://<rechner>:5184/ws/device` entgegen, normalisiert sie
(`src/m5/pipeline/`) und publiziert fertige Werte über die **eigene Origin** an die Seite.
`src/m5/index.ts` ist die Client-Seite davon. Volle Beschreibung: [`docs/m5-bridge.md`](docs/m5-bridge.md).

Praktisch heißt das:

- **Kein `?host=`, kein Zertifikat zum Nachtragen.** Der Stream läuft über dieselbe TLS-Verbindung
  wie die Seite; im Headset ist genau ein Zertifikat zu akzeptieren.
- **Controller einrichten** über `/pair.html` (Button im Start-Menü): M5 per USB anschließen,
  WLAN und Bridge-Adresse schreiben, Kabel ab. Braucht Chrome/Edge am Rechner (Web Serial).
- **Kalibrierung** in der C-Dev-Console: Rig in Ruhelage bringen, „Neutral kalibrieren". Der Wert
  liegt auf der Bridge, gilt also stationsweit und übersteht einen Reload.
- **Ohne Controller** bleibt `quality` auf 0 — das ist der normale Tastaturbetrieb, kein Fehler.
  Tastatureingaben übersteuern den Controller-Stream, solange eine Steuertaste gehalten wird.
- **Ohne Hardware testen:** `bun scripts/m5-sim.ts` (`--rest`, `--glitch`, `--button`).

Die Bridge muss im selben LAN wie der M5 laufen — der Controller kann kein `wss://` und dialt eine
IP im lokalen Netz.

## Synth auf dem Handy

Der vendored Tone.js-Synth (`src/synth/vendor/`, UI/UX bewusst unangetastet, Tone auf 14.8.49
gepinnt, von Biome und tsc ignoriert) läuft auf einer eigenen Seite:

```
https://<dev-host>:5173/synth.html
```

Standalone auf dem Handy oder als In-App-Overlay (`M`). Im Overlay-Fall schiebt der Host jeden
Frame Pose-, Flug- und Sinnessignale in `window.__bmFrame` und aktiviert beim ersten Aufblenden
eines Sinnes automatisch die zugeordnete Klangebene.

---

## Projektstruktur

```
src/
  main.ts            Einstiegspunkt: verdrahtet alle Module und die Frame-Loop
  renderer/          WebGPU-Renderer, Kamera, VRButton, Inspector
  terrain/           gestreamte Chunk-Welt (Worker-generiert)
  terrain-generator/ reine Heightfield-Erzeugung
  grass/ life/ flora-fauna/ creatures/ atmosphere/   Bewuchs, Tiere, Staub
  senses/            die neun Sinnesmodule + Director + Shader-Kompositor
  signals/           Signal-Substrat und Bus (Module reden nur hierüber)
  time/              Clock-Spine + Transport (Pause/Seek/TimeScale)
  theatre/           Theatre.js-Bindings, authored Envelopes (state.json)
  audio/             Sound-Bus, Cues, die acht Movements
  experience/        Start-Menü, Start-Gate, Interface-Modi, Credits
  dev-console/       das `C`-Overlay mit allen Tuning-Panels
  m5/                Controller: Client, Wire-Protokoll, Control-Pipeline
  pair/              USB-Einrichtungsseite (pair.html, Web Serial)
  player/ events/ minimap/ synth/ render/
public/              ausgelieferte Assets (GLB, Audio, FBX-Events)
assets/              Rohassets (nature-kit FBX/Texturen) für die Konvertierung
scripts/             Bun-Scripts: Asset-Konvertierung + Verify-Treiber
docs/                MASTERPLAN.md und die Integrationspläne
```

### Committetes Tuning

Die eingestellten Werte liegen als committete JSON-Dateien neben dem Code und werden beim Start
geladen: `src/senses/state.json`, `src/terrain/state.json`, `src/flora-fauna/state.json`,
`src/theatre/state.json`. Im Dev-Modus lädt die Dev-Konsole (`C`) die Export-Buttons
**⤓ Sinne / ⤓ World / ⤓ Flora & Fauna** dazu, die den aktuellen Live-Zustand wieder in genau
dieses Format schreiben.

### Asset-Pipeline

Einmalige Authoring-Schritte, deren Ergebnis committet ist — die Laufzeit sieht nie ein OBJ/FBX:

```bash
bun run scripts/convert-flora.ts     # OBJ-Pack -> public/life/*.glb
bun run scripts/convert-nature.ts    # nature-kit FBX -> GLB
bun run scripts/inspect-fbx.ts       # Debug-Helfer
bun run scripts/verify-nature.ts     # headless Chromium (Playwright) fährt die App an
```

---

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Canvas bleibt schwarz, keine Fehlermeldung | WebGPU fehlt oder `renderer.init()` wurde nicht abgewartet. Browser/Flags prüfen. |
| Nur ein weißes Bild | Kein Sinn aktiv — das ist der Sollzustand. Über `C` → Sinne einen Layer zuschalten. |
| Zertifikatswarnung auf Headset/Handy | mkcert-Root ist dort unbekannt; Warnung einmal akzeptieren. |
| Dev-Server nicht unter 5173 | Port belegt, Vite weicht aus — URL aus dem Banner nehmen. |
| M5-Panel zeigt „keine Bridge" | Dev-Server neu starten; die Bridge lebt in dessen Prozess. |
| M5-Panel zeigt „wartet auf Controller" | Bridge läuft, aber kein Gerät verbunden. `bun scripts/m5-sim.ts` oder Controller über `/pair.html` einrichten. |
| `[audio] failed to load …` | Platzhalter-Cues ohne Datei (`/audio/sense-*.ogg`); warnt einmal und bleibt still. |
| Tone.js meckert über den AudioContext | Browser-Autoplay-Sperre; ein Klick/Tastendruck entsperrt sie. |
| Build schlägt fehl | Typfehler. `bun run typecheck` gibt die eigentliche Meldung aus. |

---

## Deployment

`bun run serve` (bzw. das Image) startet **einen** Prozess, der `dist/` ausliefert und beide
Controller-Sockets bedient — kein nginx mehr, weil die Bridge ohnehin einen JS-Prozess braucht.

```bash
bun run build && bun run serve       # lokal
docker build -t becoming-many . && \
  docker run -p 8080:8080 -p 5184:5184 -v bm-state:/data becoming-many
```

| Port | Wofür |
|---|---|
| `8080` | Experience + Browser-Control-Stream (`/ws/m5`). TLS terminiert der Reverse-Proxy davor. |
| `5184` | Der M5. Plain `ws://`, weil die Firmware kein `wss://` kann. |

`/data` (Volume) hält Kalibrierung, Achsen-Map und Pairing-Token — ohne Volume verliert ein
Redeploy die Kalibrierung des Rigs. Die restlichen Variablen stehen in `.env.example`.

**Wichtig:** Das Image muss im LAN des Controllers laufen. Ein Remote-Deploy bekommt nie
Device-Frames — die Experience läuft dann sauber weiter, aber nur auf Tastatur.
Der GitHub-Workflow baut bei jedem Push auf `main` nach `ghcr.io`.

---

## Konventionen (Kurzfassung)

- Nur `three/webgpu` + `three/tsl` importieren, niemals den klassischen `three`-Entry. Kein GLSL,
  keine Nicht-Node-Materials.
- Intra-`src`-Imports mit expliziter `.ts`-Endung (`./renderer/index.ts`).
- Kein `any`, kein `!`, kein `as`, kein `@ts-ignore` — die TS- und Biome-Gates sind bewusst
  aufeinander abgestimmt.
- Module kommunizieren über typisierte Datenstrukturen und den Bus, nicht über globale Zustände.

Die ausführliche Fassung samt Architektur, Sense-Layer-Vertrag und WebGPU-Regeln steht in
[`AGENT.md`](AGENT.md), der Integrationsstand in [`docs/MASTERPLAN.md`](docs/MASTERPLAN.md).
