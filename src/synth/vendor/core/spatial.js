/* becoming many · core/spatial.js
   Räumliches Hören: der Tone-Listener folgt der Flug-Kamera, und pro
   räumlich gebundenem Sinn hängt ein Panner3D zwischen cut und out —
   Distanz dämpft damit Dry UND Hall-Send (post-fader-Invariante bleibt:
   Pegel/Mute wirken auf out, hinter dem Panner).

   Der Panner wird beim ersten Binden erzeugt und bleibt bis dispose in
   der Kette. "Ungebunden" heißt: sein Ziel ist die Hörer-Position
   (Distanz 0 → Gain 1, mittig) — dadurch heilen Löschen/Umstecken/
   Flug-Schließen sich selbst im Frame-Loop, ohne Umverkabeln.

   Positionen werden in JS geglättet (wie die Trägheit im Mapping):
   weich bei Binden/Lösen/Umstecken, Sprung-Erkennung beim Anker-Recycle
   (gleiche Quelle teleportiert > 120 u → snappen statt durch den Kopf
   des Hörers zu gleiten). Welt-Einheiten = Audio-Meter. */

import * as Tone from "tone";

/* Kompass-Richtungen (n = +Z wie world.forward() bei yaw 0); die Quelle
   sitzt in konstanter Entfernung um den Hörer — nur die Richtung zählt. */
const COMPASS = {
  kompass_n: [0, 0, 1], kompass_o: [1, 0, 0],
  kompass_s: [0, 0, -1], kompass_w: [-1, 0, 0],
};
const CONST_DIST = 40;
const GLIDE = 0.12;      // Glättung pro Frame (≈ 1 s bis zur Ruhe)
const SNAP = 120;        // Ziel-Sprung darüber = Teleport → snappen

export const SpatialAudio = {
  model: "equalpower",
  state: new Map(),      // layer → { sx,sy,sz (Schatten), tx,ty,tz (letztes Ziel), key }
  _listener: { x: 0, y: 0, z: 0, yaw: null, pitch: null },

  /* "equalpower" | "HRTF" — wirkt live auf alle vorhandenen Panner. */
  setModel(model, layers) {
    this.model = model;
    if (layers) layers.forEach(info => {
      const p = info.layer && info.layer.panner;
      if (p && p.panningModel !== model) p.panningModel = model;
    });
  },

  /* Panner lazy zwischen cut und out hängen. Kollabiert das Signal des
     Sinns zu Mono — erwartbar, räumliche Position ersetzt das Stereobild. */
  ensure(layer) {
    if (layer.panner) return layer.panner;
    const p = new Tone.Panner3D({
      panningModel: this.model, distanceModel: "inverse",
      refDistance: 14, rolloffFactor: 1.4, maxDistance: 320,
    });
    layer.cut.disconnect(layer.out);
    layer.cut.connect(p);
    p.connect(layer.out);
    layer.panner = p;
    const L = this._listener;
    p.setPosition(L.x, L.y, L.z);   // neutral starten, gleitet dann zum Anker
    this.state.set(layer, { sx: L.x, sy: L.y, sz: L.z, tx: L.x, ty: L.y, tz: L.z, key: null });
    return p;
  },

  /* Beim Entfernen eines Layers: nur den Zustand vergessen —
     den Panner entsorgt layer.dispose() mit den Rahmen-Knoten. */
  forget(layer) { this.state.delete(layer); },

  /* Jede Frame aus App.frame(). pose {x,y,z,yaw,pitch} oder null (Flug zu),
     anchors [{id,x,y,z}] oder null, bindings [{m, layer}] aus der FlightMap. */
  frame(pose, anchors, bindings) {
    const L = this._listener;
    if (pose) {
      // Listener nur bei Änderung schreiben (Param.value = 2 Timeline-Ops)
      if (pose.x !== L.x || pose.y !== L.y || pose.z !== L.z ||
          pose.yaw !== L.yaw || pose.pitch !== L.pitch) {
        L.x = pose.x; L.y = pose.y; L.z = pose.z;
        L.yaw = pose.yaw; L.pitch = pose.pitch;
        const li = Tone.getListener();
        li.positionX.value = L.x; li.positionY.value = L.y; li.positionZ.value = L.z;
        const cp = Math.cos(pose.pitch);
        li.forwardX.value = Math.sin(pose.yaw) * cp;
        li.forwardY.value = Math.sin(pose.pitch);
        li.forwardZ.value = Math.cos(pose.yaw) * cp;
        // up bleibt (0,1,0) — Roll ist eine leichte Bank, hörbar egal
      }
    }
    // Flug zu: Listener bleibt stehen, die Panner gleiten zu ihm zurück
    // (der Klang "kommt heim" — passt zum verschwundenen Kabel).

    // Ziel jedes gebundenen Layers auflösen (Anker- oder Kompass-Position)
    for (const b of bindings) {
      if (!pose) break;
      const q = b.m.quelle;
      let tx = null, ty = 0, tz = 0;
      const dir = COMPASS[q];
      if (dir) {
        tx = L.x + dir[0] * CONST_DIST;
        ty = L.y + dir[1] * CONST_DIST;
        tz = L.z + dir[2] * CONST_DIST;
      } else if (anchors) {
        const a = anchors.find(a => a.id === q);
        if (a) { tx = a.x; ty = a.y; tz = a.z; }
      }
      if (tx == null) continue;
      this.ensure(b.layer);
      const s = this.state.get(b.layer);
      s.wantX = tx; s.wantY = ty; s.wantZ = tz; s.wantKey = q;
      // Distanz-Charakter der Bindung (nur Orts-Wolken; Kompass dämpft nie)
      const p = b.layer.panner;
      if (dir) {
        if (p.rolloffFactor !== 0) p.rolloffFactor = 0;
      } else {
        const sp = b.m.spatial || { ref: 0.15, roll: 0.45 };
        const ref = 6 + sp.ref * 54, roll = 0.4 + sp.roll * 2.2;
        if (p.refDistance !== ref) p.refDistance = ref;
        if (p.rolloffFactor !== roll) p.rolloffFactor = roll;
      }
    }

    // Alle Panner bewegen: gebundene zum Anker, alle anderen heim zum Hörer
    for (const [layer, s] of this.state) {
      const p = layer.panner;
      if (!p || p.disposed) { this.state.delete(layer); continue; }
      let tx, ty, tz, key;
      if (pose && s.wantKey) { tx = s.wantX; ty = s.wantY; tz = s.wantZ; key = s.wantKey; }
      else { tx = L.x; ty = L.y; tz = L.z; key = null; }
      s.wantKey = null;
      // Teleport-Erkennung: gleiche Quelle, Ziel springt weit (Recycle)
      const jumped = key !== null && key === s.key &&
        (Math.abs(tx - s.tx) > SNAP || Math.abs(ty - s.ty) > SNAP || Math.abs(tz - s.tz) > SNAP);
      if (jumped) { s.sx = tx; s.sy = ty; s.sz = tz; }
      else {
        s.sx += (tx - s.sx) * GLIDE;
        s.sy += (ty - s.sy) * GLIDE;
        s.sz += (tz - s.sz) * GLIDE;
      }
      s.tx = tx; s.ty = ty; s.tz = tz; s.key = key;
      p.setPosition(s.sx, s.sy, s.sz);
    }
  },
};
