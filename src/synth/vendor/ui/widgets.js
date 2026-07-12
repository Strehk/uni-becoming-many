/* becoming many · ui/widgets.js
   Touch-Bausteine: Knob (vertikales Ziehen = Drehen) und XYPad
   (Canvas mit Pointer-Events, leuchtet in der Sinnesfarbe und
   pulsiert mit dem Pegel des Layers). */

import { PadViz } from "./padviz.js";

/* ── Knob ── vertikal ziehen; Wert 0..1 ──────────────────────── */
export class Knob {
  constructor({ label, value = 0.5, color = "#7fd4e8", onChange }) {
    this.value = value;
    this.onChange = onChange;

    this.el = document.createElement("div");
    this.el.className = "knob";
    this.el.style.setProperty("--c", color);
    this.face = document.createElement("div");
    this.face.className = "knob-face";
    const lab = document.createElement("div");
    lab.className = "k-label";
    lab.textContent = label;
    this.el.append(this.face, lab);

    let startY = 0, startV = 0;
    this.face.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.face.setPointerCapture(e.pointerId);
      startY = e.clientY; startV = this.value;
    });
    this.face.addEventListener("pointermove", (e) => {
      if (!this.face.hasPointerCapture(e.pointerId)) return;
      const v = Math.max(0, Math.min(1, startV + (startY - e.clientY) / 150));
      this.set(v, true);
    });
    // Desktop: Mausrad über dem Knob dreht fein
    this.face.addEventListener("wheel", (e) => {
      e.preventDefault();
      const v = Math.max(0, Math.min(1, this.value + (e.deltaY < 0 ? 0.02 : -0.02)));
      this.set(v, true);
    }, { passive: false });
    this.draw();
  }

  set(v, fire) {
    this.value = v;
    this.draw();
    if (fire && this.onChange) this.onChange(v);
  }

  draw() {
    // Ring von 220° bis 500° (=140°) → 280° Weg
    this.face.style.setProperty("--fill", (this.value * 280) + "deg");
    this.face.style.setProperty("--ang", (-140 + this.value * 280) + "deg");
  }
};

/* ── XYPad ── ein Finger, zwei Dimensionen ───────────────────── */
export class XYPad {
  constructor({ color = "#7fd4e8", labels = ["x", "y"], value = [0.5, 0.5], onChange, senseId }) {
    this.color = color;
    this.senseId = senseId;    // wählt die sinnes-eigene Pad-Welt (PadViz)
    this.value = [...value];
    this.onChange = onChange;
    this.level = 0;            // wird von außen mit dem Layer-Pegel gefüttert
    this.active = false;
    this.vs = {};              // Zustandsspeicher der Visualisierung

    this.el = document.createElement("div");
    this.el.className = "pad-wrap";
    this.cv = document.createElement("canvas");
    this.cv.className = "xypad";
    const labRow = document.createElement("div");
    labRow.className = "pad-labels";
    labRow.innerHTML = `<span>← ${labels[0]} →</span><span>↑ ${labels[1]}</span>`;
    this.el.append(this.cv, labRow);

    const pick = (e) => {
      const r = this.cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); // oben = 1
      this.value = [x, y];
      if (this.onChange) this.onChange(x, y);
    };
    this.cv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.cv.setPointerCapture(e.pointerId);
      this.active = true;
      pick(e);
    });
    this.cv.addEventListener("pointermove", (e) => {
      if (this.cv.hasPointerCapture(e.pointerId)) pick(e);
    });
    const end = () => { this.active = false; };
    this.cv.addEventListener("pointerup", end);
    this.cv.addEventListener("pointercancel", end);
  }

  /* Wird pro Frame vom App-Loop gerufen. */
  draw() {
    const cv = this.cv;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Breite UND Höhe prüfen — die Pads flexen im Rack auf die Resthöhe,
    // sonst wird die alte Auflösung vertikal verzerrt hochskaliert.
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Die Welt des Sinns: eigene Visualisierung, reagiert auf Touch + Pegel
    const viz = PadViz[this.senseId] || PadViz.default;
    try { viz(g, w, h, this); } catch (e) {}

    const x = this.value[0] * w;
    const y = (1 - this.value[1]) * h;

    // Pegel-Aura: der Layer atmet unter dem Finger
    const glow = 14 + this.level * 70;
    const grad = g.createRadialGradient(x, y, 2, x, y, glow);
    grad.addColorStop(0, this.color + "66");
    grad.addColorStop(1, this.color + "00");
    g.fillStyle = grad;
    g.fillRect(x - glow, y - glow, glow * 2, glow * 2);

    // Cursor-Ring
    g.strokeStyle = this.color;
    g.lineWidth = this.active ? 2.5 : 1.5;
    g.beginPath(); g.arc(x, y, this.active ? 13 : 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = this.color;
    g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
  }
};
