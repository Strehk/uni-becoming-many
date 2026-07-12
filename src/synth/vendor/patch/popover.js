/* becoming many · patch/popover.js
   Einstellungs-Popover eines Kabels: zeigt die geteilte mappingRow aus
   flight/sheet.js (Quelle, Ziel, min/max/stärke/glätte, Kurve, Löschen)
   verankert am Klickpunkt; auf schmalen Schirmen als Bottom-Sheet (CSS).
   Wird die Zuordnung anderswo gelöscht, schließt es sich selbst. */

import { mappingRow } from "../flight/sheet.js";

let openPop = null;

export function closeMappingPopover() {
  if (!openPop) return;
  openPop.unsub();
  openPop.veil.remove();
  openPop.el.remove();
  openPop = null;
}

export function openMappingPopover(map, m, x, y) {
  closeMappingPopover();
  if (!map.list.includes(m)) return;

  const veil = document.createElement("div");
  veil.id = "patch-pop-veil";
  veil.addEventListener("pointerdown", closeMappingPopover);

  const pop = document.createElement("div");
  pop.id = "patch-pop";
  const render = () => {
    if (!map.list.includes(m)) { closeMappingPopover(); return; }
    pop.innerHTML = "";
    pop.append(mappingRow(map, m));
  };
  const unsub = map.on(render);
  render();

  document.body.append(veil, pop);
  openPop = { el: pop, veil, unsub };

  // Am Klickpunkt verankern, im Fenster halten (Desktop; mobil macht CSS
  // daraus ein Bottom-Sheet und ignoriert die Koordinaten).
  if (window.innerWidth > 640) {
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
    pop.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, y + 14)) + "px";
  }
}
