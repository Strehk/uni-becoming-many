# M5-Bridge

Wie dieses Repo mit dem Flug-Controller spricht — ohne externen Host.

Vorher lief die Steuerung über den [Icaros Host](https://github.com/dweigend/Icaros_Host)
(SvelteKit + Bun): der nahm die M5-Frames entgegen, normalisierte sie und publizierte sie über
den `neural-flight.v1`-Vertrag an registrierte Clients. Das kostete zwei Origins, zwei
Zertifikate, eine Registrierungs-Zeremonie für eine einzige Experience — und der Button des
Controllers kam gar nicht erst an.

Portiert wurde aus `dweigend/Icaros_Host` @ `564218a` (2026-07-09).

---

## Die eine Randbedingung

Die Firmware (`firmware/m5-controller/src/main.cpp` im Host-Repo) ist ein WebSocket-**Client**
und akzeptiert ausschließlich `ws://` — `wss://` wird beim URL-Parsen abgelehnt:

```cpp
if (url.startsWith("wss://")) {
  return errorResult("wss URLs are not supported");
}
```

Ein Browser kann sie damit nicht direkt empfangen: er ist kein Server, und die Seite läuft
zwingend über HTTPS (WebXR). Deshalb hat dieses Repo einen kleinen Server-Anteil.

```
M5  ──ws://<rechner>:5184/ws/device──►  bridge/  ──►  wss://<eigene Origin>/ws/m5  ──►  Browser
     JSON, 20 Hz, Grad                  Pipeline       fertige Werte, -1..1
```

**Zwei Ports sind kein Designfehler**, sondern diese Randbedingung: :5173 (bzw. :8080) HTTPS für
den Browser, :5184 plain HTTP für den Controller. Der Host machte es genauso.

**Die Bridge muss im LAN des Controllers laufen.** Ein Remote-Deploy bekommt nie Device-Frames;
die Experience läuft dann auf `quality: 0` weiter — das ist der normale Tastaturbetrieb, kein
Fehlerfall.

---

## Aufbau

| Ort | Rolle |
|---|---|
| `src/m5/protocol.ts` | Beide Wire-Formate + Guards. Externe Daten bleiben `unknown`, bis sie geprüft sind. |
| `src/m5/pipeline/` | Die reine Control-Pipeline. Geteilt zwischen Bridge und Tests, keine I/O. |
| `src/m5/index.ts` | Client: `createController()` → `input` pro Frame lesen, `dispose()` am Ende. |
| `bridge/index.ts` | `createBridge()` — beide Sockets, Token-Prüfung, Fan-out. |
| `bridge/state.ts` | Persistenz in `M5_STATE_DIR` (Default `.m5/`). |
| `bridge/vite-plugin.ts` | Dev-Verdrahtung im Vite-Server. |
| `bridge/serve.ts` + `static.ts` | Produktions-Entry: liefert `dist/` **und** beide Sockets. |
| `src/pair/` | `/pair.html` — Controller per USB einrichten (Web Serial). |
| `scripts/m5-sim.ts` | Simulierter Controller für Tests ohne Hardware. |

`bridge/` importiert aus `src/m5/`, nie umgekehrt. Beide `attach*`-Funktionen nehmen einen
`node:http.Server`, deshalb teilen Dev-Plugin und Produktions-Entry dieselbe Implementierung —
Unterschied ist nur, wer den Server erzeugt.

---

## Protokoll

### M5 → Bridge (`/ws/device`, plain ws)

Newline-freies JSON, drei Frame-Typen. Nur `orientation` trägt Steuerdaten:

```jsonc
{"type":"orientation","deviceId":"…","pitch":12.4,"roll":-3.1,"quality":1,
 "buttonPressed":false,"buttonDown":false,"buttonUp":false}   // 20 Hz, pitch/roll in GRAD
{"type":"heartbeat","rssi":-54,"uptimeMs":90210,"quality":1}  // 2 Hz
{"type":"register","firmwareVersion":"0.2.2-icaros-ws-reconnect","capabilities":[…]}
```

Authentifiziert über `?pairing=<token>` in der URL, konstantzeitig verglichen. `register`- und
`heartbeat`-Frames publizieren nichts — sie halten nur die Verbindung, und dürfen nicht als
„flache Lage" durchgehen.

### Bridge → Browser (`/ws/m5`, gleiche Origin)

```jsonc
{"type":"control","control":{"pitch":0.42,"roll":-0.1,"quality":1,
   "buttonPressed":false,"buttonDown":false,"buttonUp":false,"controllerType":"m5"}}
{"type":"state","state":{"deviceConnected":true,"lastFrameAgoMs":48,
   "calibration":{…},"axisMap":{…}}}
```

Zurück darf der Browser nur *tunen*, nie steuern:
`{"type":"calibrate"}` · `{"type":"calibrate.reset"}` · `{"type":"axis","field":…,"enabled":…}`.

---

## Die Pipeline

Die Reihenfolge ist tragend und entspricht dem Gateway des Hosts:

```
normalize → axis-map → calibrate → safety → auto-neutralize → smooth
```

Achsen-Map läuft **vor** der Kalibrierung, damit eine aufgenommene Nullpose bereits in der
korrigierten Achslage liegt und ein späterer Achsentausch keine neue Kalibrierung erzwingt.
Geglättet wird zuletzt — und nicht, solange der Neutralizer das Rig auf Null hält, sonst würde
„geparkt" langsam wegdriften.

| Stufe | Was sie tut | Warum |
|---|---|---|
| `normalize` | Grad → -1..1 über **±45°**; Stale nach 1 s; `quality` clampen | 45° Neigung heißt Vollausschlag — der Fliegende muss den mechanischen Anschlag nicht erreichen. |
| `axis-map` | `swapPitchRoll` / `invertPitch` / `invertRoll` | Der M5 sitzt in einer Halterung, deren Ausrichtung nicht gegeben ist. Kein Gain, kein Offset — nur Achsen. |
| `calibrate` | persistierter Offset in -1..1 | Das Rig ruht nicht waagerecht. Statt einer Bias-Konstante im Flugcode: Ruhelage einnehmen, „Neutral kalibrieren". |
| `safety` | Wiederaufnahme bei \|x\| ≥ 0.85 oder Sprung ≥ 0.9 ⇒ neutral | Auf der Maschine liegt ein Mensch. Ein wiederverbundener oder spinnender Controller darf nicht sofort abtauchen. Button-Flanken gehen trotzdem durch. |
| `auto-neutralize` | Ruhelage (pitch 0.02, roll −0.8) 5 s stabil ⇒ auf 0 | Die unbelastete Liege steht mechanisch verkippt; ohne das würde der Gleiter im Leerlauf langsam in den Boden fliegen. |
| `smooth` | lerp 0.25 Richtung neuem Wert | Ein wiederaufgenommener Stream soll nicht schnappen. `quality: 0` geht ungeglättet durch — neutral muss sofort landen. |

Zusätzlich außerhalb der Stufen: wird der Device-Socket 1 s still (ohne sich zu schließen),
publiziert die Bridge neutral, statt die letzte Lage zu halten.

Die Konstanten sind auf die physische Maschine getunt. Sie haben Tests neben sich
(`src/m5/pipeline/*.test.ts`, ebenfalls portiert) — wer eine ändert, ändert das Flugverhalten.

---

## Controller einrichten

`/pair.html` (Button im Start-Menü). Web Serial spricht direkt über USB mit dem M5; die Bridge ist
daran nicht beteiligt. Nur Chrome/Edge am Rechner — im Headset gibt es kein Web Serial, was in
Ordnung ist: konfiguriert wird am Schreibtisch mit Kabel.

1. M5 per USB anschließen, „Controller verbinden", Port im Browser-Dialog wählen.
2. WLAN-SSID und -Passwort eintragen. Die **Bridge-URL** ist bereits vorbelegt — sie kommt aus
   dem eigenen Hostnamen plus dem Token von `GET /api/m5/token`. Von der Station aus geöffnet ist
   sie damit schon richtig.
3. „Auf den Controller schreiben" → die Seite schickt eine Zeile
   `{"type":"configure","ssid":…,"password":…,"serverUrl":"ws://…","deviceId":…}`.
4. „Diagnose" prüft, ob der Controller WLAN und Bridge erreicht. Kabel abziehen.

Das Lage-Pad zeigt live die Orientierungs-Frames: liegt der Controller flach und der Punkt nicht
in der Mitte, sitzt er verdreht in der Halterung — das korrigiert die Achsen-Map, nicht die
Kalibrierung.

**Firmware flashen ist nicht Teil davon.** Das bleibt der manuelle PlatformIO-Schritt im
Host-Repo; die Firmware selbst wird hier nur auf einen anderen Port gezeigt.

---

## Ohne Hardware testen

```bash
bun run dev                        # Terminal 1
bun scripts/m5-sim.ts              # Terminal 2 — Sinus-Sweep, der Gleiter fliegt Kurven
bun scripts/m5-sim.ts --rest       # Ruhelage: nach 5 s muss der Wert auf exakt 0 springen
bun scripts/m5-sim.ts --glitch     # Vollausschlag-Sprung alle 5 s: darf den Browser nie erreichen
bun scripts/m5-sim.ts --button     # Button im Sekundentakt (Start-Gate)
```

Der Simulator liest denselben Pairing-Token aus `.m5/`. Gegen einen Container:
`M5_PAIRING_TOKEN=$(curl -s http://<host>/api/m5/token | jq -r .token) bun scripts/m5-sim.ts --host <host> --port 5184`.

---

## Konfiguration

Alles hat Defaults; siehe `.env.example`.

| Variable | Default | Wofür |
|---|---|---|
| `M5_DEVICE_PORT` | `5184` | Plain-ws-Port für den Controller. |
| `M5_STATE_DIR` | `.m5` (Container: `/data`) | Kalibrierung, Achsen-Map, Token. **Als Volume mounten.** |
| `M5_PAIRING_TOKEN` | generiert + persistiert | Nur setzen, wenn der Token einen gelöschten Volume überleben soll. |
| `PORT` | `8080` | Nur `bridge/serve.ts`: App + Browser-Stream. |

---

## Was dabei weggefallen ist

`src/icaros/` · `?host=` · `VITE_ICAROS_HOST` · `scripts/start.ts` (`bun start <ip>`) ·
das Docker-Build-Arg und die GHCR-Repo-Variable · `docker/nginx.conf` ·
`PITCH_BIAS = 0.4` in `main.ts` (der Client-Hack, den die Kalibrierung jetzt richtig löst).

Ebenfalls weg, und das ist der Preis: die **Operator-Console** und das `/launch`-Routing des
Hosts. Das Headset öffnet jetzt direkt die URL dieser Experience. Sollte die Station je mehrere
Experiences fahren, kommt der Host als reiner Router davor zurück — die Bridge bleibt davon
unberührt.
