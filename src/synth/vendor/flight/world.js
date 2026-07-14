/* becoming many · flight/world.js — SIGNAL-QUELLE statt Demo-Flugwelt.
   (Integrations-Ersatz: die frühere three.js-Platzhalterwelt ist entfallen.
   Die ECHTE Welt — Becoming Many — schiebt pro Frame ein Objekt in
   `window.__bmFrame`:

     { t, pose:{x,y,z,yaw,pitch},
       params:{hoehe,tempo,kurve,neigung,naehe,richtung},   // alle 0..1
       senses:{sinn_farben,…, unrest, intensity, quality},  // alle 0..1
       anchors:[{id:"duft_blume",x,y,z}, …] }

   Diese Klasse hält denselben Vertrag wie die alte FlightWorld
   (params / pos / yaw / pitch / anchors, in-place mutiert), damit
   App.frame(), FlightMap und SpatialAudio unverändert weiterlaufen.
   Ohne Host-Frame (Standalone auf dem Handy) bleiben die Werte stehen —
   Zuordnungen frieren ein, genau wie beim geschlossenen Flug-Modul. */

const ANCHOR_IDS = [
  "duft_blume", "duft_lavendel", "duft_baum",
  "duft_kiefer", "duft_kraut", "duft_pilz",
];

export class SignalWorld {
  constructor() {
    this.params = { hoehe: 0.5, tempo: 0.5, kurve: 0.5, neigung: 0.5, naehe: 0, richtung: 0 };
    this.senses = {};
    this.pos = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.anchors = ANCHOR_IDS.map((id, i) => ({
      id,
      x: Math.cos(i * 1.57) * 40,
      y: 6,
      z: Math.sin(i * 1.57) * 40,
      boundColor: null,
    }));
    this.hasFrame = false;
  }

  /* Den zuletzt vom Host gepushten Frame übernehmen (in-place, allocfrei). */
  update() {
    const f = window.__bmFrame;
    if (!f) return;
    this.hasFrame = true;
    if (f.params) Object.assign(this.params, f.params);
    if (f.senses) Object.assign(this.senses, f.senses);
    if (f.pose) {
      this.pos.x = f.pose.x; this.pos.y = f.pose.y; this.pos.z = f.pose.z;
      this.yaw = f.pose.yaw || 0;
      this.pitch = f.pose.pitch || 0;
    }
    if (Array.isArray(f.anchors)) {
      for (const a of this.anchors) {
        const src = f.anchors.find(x => x.id === a.id);
        if (src) { a.x = src.x; a.y = src.y; a.z = src.z; }
      }
    }
  }
}
