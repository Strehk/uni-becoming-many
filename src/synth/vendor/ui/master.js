/* becoming many · ui/master.js
   Das Master-Modul: eine Rack-Karte für die globale Klangkette —
   EQ (tiefen/mitten/höhen), Filter, Delay und der Charakter des
   gemeinsamen Halls. Die Kette lebt in core/engine.js (engine.fx ist
   die Quelle der Wahrheit für alle Stellungen); unten sitzen
   Eingangs-Buchsen, damit Flugwerte auch die Summe patchen können. */

import { Knob } from "./widgets.js";
import { REVERB_PRESETS } from "../core/engine.js";
import { MASTER_TARGETS, MASTER_COLOR } from "../flight/mapping.js";
import { Ports } from "../patch/ports.js";
import { openMappingPopover } from "../patch/popover.js";

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};

export const MasterModule = {
  active: false,
  hall: "halle",
  knobs: {},          // control → Knob (für Sync nach dem Flug)

  toggle(app) { this.active ? this.close() : this.open(app); },

  open(app) {
    this.app = app;
    if (!this.card) this.buildCard(app.engine);
    app.empty.remove();
    app.list.append(this.card);
    this.registerPorts();
    this.syncKnobs();
    this.active = true;
    this.syncBtn();
  },

  close() {
    Ports.unregister("master|");
    this.card.remove();
    this.active = false;
    this.syncBtn();
    if (!this.app.layers.length) this.app.list.append(this.app.empty);
  },

  syncBtn() {
    const b = document.getElementById("master-btn");
    if (b) b.classList.toggle("on", this.active);
  },

  /* Knöpfe auf die echten Engine-Stellungen setzen — z. B. nachdem
     der Flug per Kabel daran gedreht hat. */
  syncKnobs() {
    if (!this.app) return;
    const fx = this.app.engine.fx;
    Object.entries(this.knobs).forEach(([control, k]) => {
      if (fx[control] != null) k.set(fx[control], false);
    });
  },

  registerPorts() {
    Ports.unregister("master|");
    MASTER_TARGETS.forEach(([control, label]) => {
      Ports.register({ id: `master|in|${control}`, dir: "in",
        el: this.portEls[control], color: MASTER_COLOR, label });
    });
  },

  buildCard(engine) {
    // Akzentfarbe (--c/--pc) kommt aus dem CSS und folgt dem Night/Day-Modus
    const card = this.card = h("div", "card master-card");

    const head = h("div", "card-head");
    const closeBtn = h("button", "icon-btn", "×");
    closeBtn.title = "master schließen";
    closeBtn.addEventListener("click", () => this.close());
    head.append(
      h("span", "dot"),
      h("div", "card-title",
        `<div class="name">Master <span class="variant-tag">· summe</span></div>
         <div class="sub">klangfarbe · echo · hall — wirkt auf alles</div>`),
      closeBtn,
    );
    card.append(head);

    const fx = engine.fx;
    this.portEls = {};
    const mk = (parent, control, label, onChange) => {
      const k = new Knob({ label, value: fx[control], color: MASTER_COLOR, onChange });
      k.el.style.removeProperty("--c");   // Farbe themed über .master-card
      // Eingangs-Buchse direkt am Regler (--pc erbt von .master-card)
      const jack = h("div", "port in");
      jack.dataset.target = "master|" + control;
      jack.addEventListener("pointerdown", (e) => {
        const m = this.app.flightMap.list.find(x => x.layerId === "master" && x.control === control);
        if (m) { e.stopPropagation(); openMappingPopover(this.app.flightMap, m, e.clientX, e.clientY); }
      });
      k.el.append(jack);
      this.portEls[control] = jack;
      parent.append(k.el);
      this.knobs[control] = k;
      return k;
    };

    card.append(h("div", "ext-section in-card", "klangfarbe"));
    const eqRow = h("div", "knob-row");
    mk(eqRow, "eqlow", "tiefen", v => engine.setEq("low", v));
    mk(eqRow, "eqmid", "mitten", v => engine.setEq("mid", v));
    mk(eqRow, "eqhigh", "höhen", v => engine.setEq("high", v));
    mk(eqRow, "filter", "filter", v => engine.setFilterCutoff(v));
    card.append(eqRow);

    card.append(h("div", "ext-section in-card", "echo"));
    const dlRow = h("div", "knob-row");
    mk(dlRow, "delaymix", "anteil", v => engine.setDelayMix(v));
    mk(dlRow, "delaytime", "zeit", v => engine.setDelayTime(v));
    mk(dlRow, "delayfb", "rückwurf", v => engine.setDelayFeedback(v));
    card.append(dlRow);

    card.append(h("div", "ext-section in-card", "hall-charakter"));
    const pills = h("div", "chord-chips in-card");
    Object.keys(REVERB_PRESETS).forEach(name => {
      const b = h("button", "pill" + (name === this.hall ? " active" : ""), name);
      b.addEventListener("click", () => {
        this.hall = name;
        engine.setReverbCharacter(name);
        pills.querySelectorAll(".pill").forEach(p =>
          p.classList.toggle("active", p === b));
      });
      pills.append(b);
    });
    card.append(pills);
  },
};
