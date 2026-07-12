/* becoming many · patch/cables.js
   Die Patch-Kabel: ein SVG-Overlay über dem Rack. Jede Zuordnung der
   FlightMap, deren beide Buchsen sichtbar sind, wird als hängendes
   Bezier-Kabel in der Sinnesfarbe des Ziels gezeichnet. Ziehen von einer
   Ausgangs-Buchse zu einer Eingangs-Buchse legt eine Zuordnung an;
   Tippen auf ein Kabel öffnet sein Einstellungs-Popover.
   Neu gezeichnet wird im zentralen rAF-Loop der App — aber nur, wenn
   das Dirty-Flag gesetzt ist (Scroll, Resize, Layout, Map-Änderung, Drag). */

import { Ports } from "./ports.js";
import { openMappingPopover } from "./popover.js";

const NS = "http://www.w3.org/2000/svg";

export const Cables = {
  drag: null,          // { fromId, quelle, color, x, y, overIn }

  init(app, map) {
    this.app = app;
    this.map = map;
    this.dirty = true;

    this.svg = document.createElementNS(NS, "svg");
    this.svg.id = "cables";
    app.rack.append(this.svg);

    map.on(() => { this.dirty = true; });
    Ports.onChange = () => { this.dirty = true; };
    window.addEventListener("scroll", () => { this.dirty = true; }, { capture: true, passive: true });
    window.addEventListener("resize", () => { this.dirty = true; });
    new ResizeObserver(() => { this.dirty = true; }).observe(app.list);
    // Night/Day-Wechsel (body-Klasse) → Kabelfarben neu auflösen
    new MutationObserver(() => { this.dirty = true; })
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  },

  /* ---------- Geometrie ---------- */
  center(el) {
    const r = el.getBoundingClientRect();
    const s = this.svg.getBoundingClientRect();
    return [r.left + r.width / 2 - s.left, r.top + r.height / 2 - s.top];
  },

  pathD(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const sag = Math.min(120, dist * 0.25) + 12;
    return `M ${x1} ${y1} C ${x1} ${y1 + sag}, ${x2} ${y2 + sag}, ${x2} ${y2}`;
  },

  /* Wird jede Frame aus App.frame() gerufen. */
  frame() {
    if (this.drag) { this.edgeScroll(); this.updateHover(); }
    if (!this.dirty && !this.drag) return;
    this.dirty = false;
    this.render();
  },

  /* Gültiges Ziel unter dem Zeiger markieren. Läuft pro Frame, weil beim
     Rand-Scrollen die Buchsen unter dem stehenden Zeiger durchwandern —
     und weil Pointer-Capture pointerenter unterdrückt (elementFromPoint). */
  updateHover() {
    const d = this.drag;
    if (d.clientX == null) return;
    const hitEl = document.elementFromPoint(d.clientX, d.clientY);
    const inEl = hitEl && hitEl.closest(".port.in");
    if (d.overIn && d.overIn !== inEl) d.overIn.classList.remove("hover");
    d.overIn = inEl || null;
    if (inEl) inEl.classList.add("hover");
  },

  /* Beim Ziehen am Fensterrand weiterscrollen — so erreichen Kabel
     auch Module, die gerade nicht im Blick sind. */
  edgeScroll() {
    const y = this.drag.clientY;
    if (y == null) return;
    const edge = 70;
    if (y > window.innerHeight - edge) window.scrollBy(0, 14);
    else if (y < edge && window.scrollY > 0) window.scrollBy(0, -14);
  },

  render() {
    this.svg.innerHTML = "";
    const connected = new Set();
    for (const m of this.map.list) {
      const out = Ports.out(m.quelle);
      const inp = Ports.get(`${m.layerId}|in|${m.control}`);
      if (!out || !inp) continue;
      connected.add(out.el); connected.add(inp.el);
      const [x1, y1] = this.center(out.el);
      const [x2, y2] = this.center(inp.el);
      const d = this.pathD(x1, y1, x2, y2);
      const color = this.map.colorOf(m.layerId);

      const vis = document.createElementNS(NS, "path");
      vis.setAttribute("d", d);
      vis.setAttribute("class", "cable");
      vis.setAttribute("stroke", color);

      const hit = document.createElementNS(NS, "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "cable-hit");
      hit.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        openMappingPopover(this.map, m, e.clientX, e.clientY);
      });

      this.svg.append(vis, hit);
    }
    [...Ports.ins(), ...Ports.outs()].forEach(p =>
      p.el.classList.toggle("connected", connected.has(p.el)));

    // Gummikabel während des Ziehens (Endpunkt aus Fensterkoordinaten,
    // damit es beim Rand-Scrollen am Finger bleibt)
    if (this.drag && this.drag.clientX != null) {
      const out = Ports.get(this.drag.fromId);
      if (out) {
        const s = this.svg.getBoundingClientRect();
        const [x1, y1] = this.center(out.el);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", this.pathD(x1, y1,
          this.drag.clientX - s.left, this.drag.clientY - s.top));
        p.setAttribute("class", "cable dragging");
        p.setAttribute("stroke", this.drag.color);
        this.svg.append(p);
      }
    }
  },

  /* ---------- Drag: Buchse → Buchse ---------- */
  /* Wird von jeder out-Buchse beim Anlegen verdrahtet. */
  bindOutPort(el, portId, quelle, color) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      this.drag = { fromId: portId, quelle, color,
        clientX: e.clientX, clientY: e.clientY, overIn: null };
      document.body.classList.add("patching");
      // Orts-Kabel wollen Ort-Buchsen (und umgekehrt) — CSS dimmt den Rest.
      document.body.classList.toggle("patching-spatial", this.map.isSpatial(quelle));
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.drag.clientX = e.clientX;
      this.drag.clientY = e.clientY;
      // Ziel-Erkennung übernimmt updateHover() im Frame-Loop.
    });
    const end = (e) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      document.body.classList.remove("patching", "patching-spatial");
      // Frische Ziel-Prüfung am Loslass-Punkt (Frame-Loop kann 1 Frame hinken)
      const hitEl = e.clientX != null && document.elementFromPoint(e.clientX, e.clientY);
      const inEl = (hitEl && hitEl.closest(".port.in")) || d.overIn;
      if (d.overIn) d.overIn.classList.remove("hover");
      if (inEl && e.type === "pointerup") {
        inEl.classList.remove("hover");
        const targetId = inEl.dataset.target;   // "L3|padx"
        if (targetId) this.map.add(targetId, d.quelle);
      }
      this.dirty = true;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  },
};
