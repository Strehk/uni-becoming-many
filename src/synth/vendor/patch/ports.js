/* becoming many · patch/ports.js
   Das Buchsen-Register: Jede Modul-Karte meldet ihre Ein-/Ausgänge an.
   Port-IDs sind dreiteilig "modul|richtung|param":
     flight|out|hoehe   – Flugwert-Ausgang am Flug-Modul
     L3|in|padx         – Regler-Eingang an einer Synth-Karte
   Das Suffix eines In-Ports ("L3|padx" → layerId|control) ist exakt die
   Ziel-ID der FlightMap. Später können weitere Quellen (Sensoren, LFOs)
   eigene out-Ports anmelden — das Register ist mehrquellenfähig. */

const ports = new Map();   // id → { id, dir, el, color, label }

export const Ports = {
  onChange: null,          // wird vom Kabel-Overlay gesetzt (dirty-Flag)

  register(p) {
    ports.set(p.id, p);
    if (this.onChange) this.onChange();
  },

  /* Alle Ports eines Moduls abmelden (Präfix "L3|" oder "flight|"). */
  unregister(prefix) {
    let hit = false;
    for (const id of [...ports.keys()]) {
      if (id.startsWith(prefix)) { ports.delete(id); hit = true; }
    }
    if (hit && this.onChange) this.onChange();
  },

  get(id) {
    const p = ports.get(id);
    return p && p.el.isConnected ? p : null;
  },

  ins()  { return [...ports.values()].filter(p => p.dir === "in"  && p.el.isConnected); },
  outs() { return [...ports.values()].filter(p => p.dir === "out" && p.el.isConnected); },

  /* Out-Buchse einer Quelle, egal welches Modul sie anbietet
     ("hoehe" → flight|out|hoehe, "lfo_a" → lfo|out|lfo_a). */
  out(param) {
    return this.outs().find(p => p.id.endsWith("|out|" + param)) || null;
  },
};
