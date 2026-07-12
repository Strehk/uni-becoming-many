/* becoming many · ui/padviz.js
   Jeder Sinn sieht anders aus: Das XY-Pad zeigt eine lebendige Welt, die
   zur Wahrnehmung passt und auf Berührung UND Klangpegel reagiert.
   Renderer bekommen (g, w, h, pad); pad liefert value [x,y], level (0..1),
   active (Finger liegt auf), color und vs (freier Zustandsspeicher). */

export const PadViz = {};

  const now = () => performance.now() / 1000;
  const isDay = () => document.body.classList.contains("day");
  const cursor = (p, w, h) => [p.value[0] * w, (1 - p.value[1]) * h];
  const dt = (vs) => {
    const t = now(), d = Math.min(0.05, t - (vs.pt || t));
    vs.pt = t; return d || 0.016;
  };

  /* Standard: feines Raster + Fadenkreuz (für Sinne ohne eigene Welt). */
  PadViz.default = (g, w, h, p) => {
    g.strokeStyle = isDay() ? "rgba(20,30,45,0.07)" : "rgba(255,255,255,0.05)"; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((w / 4) * i, 0); g.lineTo((w / 4) * i, h); g.stroke();
      g.beginPath(); g.moveTo(0, (h / 4) * i); g.lineTo(w, (h / 4) * i); g.stroke();
    }
    const [cx, cy] = cursor(p, w, h);
    g.strokeStyle = p.color + "33";
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
    g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke();
  };

  /* LUFT — Luftteilchen strömen; der Finger verwirbelt sie. */
  PadViz.luft = (g, w, h, p) => {
    const vs = p.vs; const t = now();
    if (!vs.q || vs.w !== w) {
      vs.w = w;
      vs.q = Array.from({ length: 44 }, () => ({
        x: Math.random() * w, y: Math.random() * h, vx: 0.3, vy: 0 }));
    }
    const [cx, cy] = cursor(p, w, h);
    const dir = (p.value[0] - 0.5) * 2;                 // Zugrichtung
    const str = 0.25 + p.value[1] * 1.6 + p.level * 2;  // Windstärke + Pegel
    g.lineWidth = 1.2;
    for (const q of vs.q) {
      q.vx += dir * 0.05 * str + Math.sin(q.y * 0.045 + t * 1.3) * 0.03 * str;
      q.vy += Math.cos(q.x * 0.03 + t * 0.9) * 0.028 * str;
      if (p.active) {                                   // Wirbel um den Finger
        const dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy);
        if (d < 80 && d > 1) {
          const f = (80 - d) / 80;
          q.vx += (dx / d) * f * 1.4 - (dy / d) * f * 0.9;
          q.vy += (dy / d) * f * 1.4 + (dx / d) * f * 0.9;
        }
      }
      q.vx *= 0.94; q.vy *= 0.94;
      q.x += q.vx * 2.2; q.y += q.vy * 2.2;
      if (q.x < -10) q.x = w + 10; if (q.x > w + 10) q.x = -10;
      if (q.y < -10) q.y = h + 10; if (q.y > h + 10) q.y = -10;
      const sp = Math.hypot(q.vx, q.vy);
      g.strokeStyle = p.color;
      g.globalAlpha = Math.min(0.08 + sp * 0.5, 0.8);
      g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - q.vx * 9, q.y - q.vy * 9); g.stroke();
    }
    g.globalAlpha = 1;
  };

  /* ECHOORTUNG — Sonar-Ringe vom Finger; Objekte blitzen, wenn ein Ring sie trifft. */
  PadViz.echo = (g, w, h, p) => {
    const vs = p.vs; const t = now();
    if (!vs.rings) {
      vs.rings = []; vs.last = 0;
      vs.dots = Array.from({ length: 6 }, () => ({
        x: 20 + Math.random() * (w - 40), y: 15 + Math.random() * (h - 30), f: 0 }));
    }
    const [cx, cy] = cursor(p, w, h);
    const gap = Math.max(0.25, (p.active ? 0.55 : 1.5) - p.level * 0.8);
    if (t - vs.last > gap) { vs.last = t; vs.rings.push({ x: cx, y: cy, r: 4, a: 0.85 }); }
    for (const r of vs.rings) {
      r.r += 0.8 + p.value[0] * 2.4; r.a *= 0.964;
      g.strokeStyle = p.color; g.globalAlpha = r.a; g.lineWidth = 1.5;
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, Math.PI * 2); g.stroke();
      for (const d of vs.dots) {                        // Ring trifft Objekt → Blitz
        if (Math.abs(Math.hypot(d.x - r.x, d.y - r.y) - r.r) < 5 && r.a > 0.1) d.f = 1;
      }
    }
    vs.rings = vs.rings.filter(r => r.a > 0.03 && r.r < Math.max(w, h) * 1.2);
    for (const d of vs.dots) {
      d.f *= 0.92;
      g.globalAlpha = 0.14 + d.f * 0.86; g.fillStyle = p.color;
      g.beginPath(); g.arc(d.x, d.y, 2.2 + d.f * 3.5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  };

  /* MOTION — seismische Wellen; Berührung löst Erschütterungen aus. */
  PadViz.motion = (g, w, h, p) => {
    const vs = p.vs; const t = now(); const d = dt(vs);
    if (!vs.imp) { vs.imp = []; vs.lastImp = 0; }
    const [cx] = cursor(p, w, h);
    if (p.active && t - vs.lastImp > 0.18) { vs.lastImp = t; vs.imp.push({ x: cx, age: 0 }); }
    if (p.level > 0.22 && Math.random() < 0.06) vs.imp.push({ x: Math.random() * w, age: 0 });
    vs.imp.forEach(i => i.age += d);
    vs.imp = vs.imp.filter(i => i.age < 1.6);
    const speed = 0.6 + p.value[0] * 4.5;
    const amp = 2.5 + p.level * 26 + p.value[1] * 5;
    g.lineWidth = 1.4;
    [0.28, 0.5, 0.72].forEach((fy, li) => {
      const y0 = h * fy;
      g.strokeStyle = p.color; g.globalAlpha = 0.28 + li * 0.14 + p.level * 0.4;
      g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        let y = Math.sin(x * 0.022 - t * speed + li * 1.7) * amp;
        for (const i of vs.imp) {
          const dx = x - i.x;
          y += Math.exp(-(dx * dx) / 6000) * Math.exp(-i.age * 2.4)
             * 28 * Math.sin(i.age * 16 - Math.abs(dx) * 0.05);
        }
        x ? g.lineTo(x, y0 + y) : g.moveTo(x, y0 + y);
      }
      g.stroke();
    });
    g.globalAlpha = 1;
  };

  /* LICHTSPEKTREN — schwebende Prismenfunken in Spektralfarben. */
  PadViz.licht = (g, w, h, p) => {
    const vs = p.vs; const t = now();
    if (!vs.s || vs.w !== w) {
      vs.w = w;
      vs.s = Array.from({ length: 34 }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vy: -(0.12 + Math.random() * 0.35), ph: Math.random() * 6.28,
        sz: 2 + Math.random() * 3, life: -1 }));
    }
    const [cx, cy] = cursor(p, w, h);
    if (p.active && Math.random() < 0.5) {              // Berührung sprüht Funken
      vs.s.push({ x: cx + (Math.random() - 0.5) * 14, y: cy + (Math.random() - 0.5) * 14,
        vy: -(0.6 + Math.random() * 1.4), ph: Math.random() * 6.28,
        sz: 1.5 + Math.random() * 2.5, life: 1 });
    }
    const hueShift = p.value[0] * 150, tw = 1.2 + p.value[1] * 6;
    const lum = isDay() ? 50 : 66;   // auf hellem Grund dunklere Funken
    for (const s of vs.s) {
      s.y += s.vy * (1 + p.level * 2.5);
      if (s.y < -6) { s.y = h + 6; s.x = Math.random() * w; }
      if (s.life > 0) s.life -= 0.02;
      const a = (0.2 + 0.7 * Math.abs(Math.sin(t * tw + s.ph)))
              * (s.life < 0 ? 1 : Math.max(0, s.life));
      g.globalAlpha = a;
      g.fillStyle = `hsl(${(190 + (s.x / w) * 160 + hueShift) % 360} 90% ${lum}%)`;
      g.save(); g.translate(s.x, s.y); g.rotate(t * 0.6 + s.ph);
      g.fillRect(-s.sz / 2, -s.sz / 2, s.sz, s.sz); g.restore();
    }
    vs.s = vs.s.filter(s => s.life !== 0 && !(s.life > 0 && s.life <= 0.02));
    if (vs.s.length > 70) vs.s.splice(0, vs.s.length - 70);
    g.globalAlpha = 1;
  };

  /* CHEMIE — Duft-Schlieren diffundieren vom Finger aus in den Raum. */
  PadViz.chemie = (g, w, h, p) => {
    const vs = p.vs; const t = now();
    if (!vs.b) { vs.b = []; vs.lastA = 0; vs.lastT = 0; }
    const [cx, cy] = cursor(p, w, h);
    if (p.active && t - vs.lastT > 0.13) {
      vs.lastT = t; vs.b.push({ x: cx, y: cy, r: 5, a: 0.5, ph: Math.random() * 6.28 });
    }
    if (t - vs.lastA > 0.7) {
      vs.lastA = t;
      vs.b.push({ x: Math.random() * w, y: Math.random() * h, r: 4,
                  a: 0.22 + p.level * 0.5, ph: Math.random() * 6.28 });
    }
    const grow = 0.35 + (1 - p.value[0]) * 1.3 + p.level;   // Schärfe: klein & dicht
    // Nacht: additiv (leuchtet auf), Tag: multiplikativ (dunkelt Schwaden ein)
    g.globalCompositeOperation = isDay() ? "multiply" : "lighter";
    for (const b of vs.b) {
      b.r += grow; b.a *= 0.975;
      b.x += Math.sin(t * 0.7 + b.ph) * 0.35;
      b.y -= 0.15 + p.value[1] * 0.3;                       // Diffusion steigt auf
      const gr = g.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.r);
      gr.addColorStop(0, p.color + "55");
      gr.addColorStop(1, p.color + "00");
      g.globalAlpha = b.a; g.fillStyle = gr;
      g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    vs.b = vs.b.filter(b => b.a > 0.02);
    if (vs.b.length > 26) vs.b.splice(0, vs.b.length - 26);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  };

  /* MAGNETFELD — Feldlinien zwischen zwei Polen biegen sich zum Finger. */
  PadViz.magnet = (g, w, h, p) => {
    const t = now();
    const [cx, cy] = cursor(p, w, h);
    const pl = { x: w * 0.08, y: h * 0.5 }, pr = { x: w * 0.92, y: h * 0.5 };
    g.lineWidth = 1.2;
    for (let k = -4; k <= 4; k++) {
      const mx = w / 2 + (cx - w / 2) * 0.75;
      const my = h / 2 + (cy - h / 2) * 0.95
               + k * h * 0.105 * (1 + 0.14 * Math.sin(t * 0.9 + k));
      g.strokeStyle = p.color;
      g.globalAlpha = 0.1 + p.level * 0.6 + (k === 0 ? 0.12 : 0);
      g.beginPath(); g.moveTo(pl.x, pl.y);
      g.quadraticCurveTo(mx, my, pr.x, pr.y); g.stroke();
    }
    for (const pole of [pl, pr]) {                       // Pole glimmen im Pegel
      const gr = g.createRadialGradient(pole.x, pole.y, 1, pole.x, pole.y, 14 + p.level * 22);
      gr.addColorStop(0, p.color + "aa"); gr.addColorStop(1, p.color + "00");
      g.globalAlpha = 0.7; g.fillStyle = gr;
      g.beginPath(); g.arc(pole.x, pole.y, 14 + p.level * 22, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  };

  /* 180°-SICHT — Blickpunkte wandern auf Panorama-Bögen hin und her. */
  PadViz.sicht = (g, w, h, p) => {
    const vs = p.vs; const d = dt(vs);
    if (!vs.d) {
      vs.d = Array.from({ length: 9 }, (_, i) => ({
        ring: i % 4, ang: Math.PI + Math.random() * Math.PI,
        sp: (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? 1 : -1) }));
    }
    const ox = w / 2, oy = h * 0.97;
    const spread = 0.55 + p.value[1] * 0.5;
    const radii = [0.3, 0.5, 0.7, 0.9].map(r => r * h * spread + h * 0.12);
    g.lineWidth = 1;
    for (const r of radii) {                             // die Panorama-Bögen
      g.strokeStyle = p.color; g.globalAlpha = 0.09;
      g.beginPath(); g.arc(ox, oy, r, Math.PI, Math.PI * 2); g.stroke();
    }
    const speed = 0.2 + p.value[0] * 1.8;
    for (const q of vs.d) {
      q.ang += q.sp * speed * d;
      if (q.ang > Math.PI * 2 - 0.06 || q.ang < Math.PI + 0.06) q.sp *= -1; // Blick kehrt um
      const r = radii[q.ring];
      const x = ox + Math.cos(q.ang) * r, y = oy + Math.sin(q.ang) * r;
      g.globalAlpha = 0.35 + p.level * 0.65;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x, y, 2.4 + p.level * 3, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.12;
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(x, y); g.stroke();  // Blickstrahl
    }
    g.globalAlpha = 1;
  };
