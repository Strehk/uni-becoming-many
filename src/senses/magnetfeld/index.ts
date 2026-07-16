// ── Magnetfeld sense — public facade + signal coupling ─────────
//
// Owns the sky dome (a large back-side sphere that follows the player) and wires it
// onto the substrate:
//
//   - `signals.sense.magnetfeld` is the target visibility; `update(dt)` eases the
//     dome's opacity toward it (and hides the mesh entirely at 0 — no wasted GPU).
//   - `uSkyTime` follows `signals.time`, so the sky animation obeys pause/seek.
//   - `sense:param {id:"magnetfeld", key, value}` bus commands write the field axis,
//     the global tempo, the nine mode weights (`weight.<mode>`) and every per-mode
//     parameter (`<mode>.<param>`) — the full prototype dev-tool surface.
//   - `controls` is the descriptor the shared sense UI renders.

import * as THREE from "three/webgpu";
import { Color } from "three/webgpu";
import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import {
  MODES,
  MODE_KEYS,
  type ModeKey,
  createSkyMaterial,
  field,
  globalU,
  modeU,
  uSkyTime,
  uVisibility,
  weights,
} from "./sky.ts";

/** Seconds the sky takes to fade fully in/out when the signal flips 0 ↔ 1. */
const FADE_SECONDS = 3.0;
/** Dome radius — inside the camera far plane, outside the fog. */
const DOME_RADIUS = 900;

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export interface MagnetfeldSense {
  /** Control descriptor for the shared sense UI. */
  readonly controls: SensePanelDescriptor;
  /** Ease visibility, follow the player, feed the spine time. Once per frame. */
  update(dt: number): void;
  /** Set the weight of one blend mode (0..1) — e.g. the authored field-line-dome
   *  mix from the Theatre timeline. Same target as the panel's `weight.<mode>`. */
  setModeWeight(mode: ModeKey, weight: number): void;
  dispose(): void;
}

type AnyUniform = { value: number } | { value: Color };

/** Flat parameter registry: "decl" / "speed" / "weight.<mode>" / "<mode>.<param>". */
function buildParamRegistry(): Map<string, AnyUniform> {
  const map = new Map<string, AnyUniform>();
  map.set("decl", field.decl);
  map.set("elev", field.elev);
  map.set("speed", globalU.speed);
  for (const key of MODE_KEYS) {
    map.set(`weight.${key}`, weights[key]);
    for (const [param, u] of Object.entries(modeU[key])) {
      map.set(`${key}.${param}`, u);
    }
  }
  return map;
}

/** Slider metadata per mode parameter (ranges from the prototype's dev tool). */
const MODE_SLIDERS: Record<ModeKey, [string, string, number, number, number][]> = {
  aurora: [
    ["intensity", "Intensität", 0, 3, 0.01],
    ["breite", "Breite (um Nord)", 0, 1, 0.01],
    ["hoehe", "Vorhang-Höhe", 0.3, 1.5, 0.01],
    ["sar", "Süd-Bogen (SAR)", 0, 2, 0.01],
    ["sterne", "Sterne", 0, 2, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  lines: [
    ["freq", "Liniendichte", 4, 40, 1],
    ["wobble", "Verwacklung", 0, 3, 0.01],
    ["pulse", "Puls-Stärke", 0, 3, 0.01],
    ["dashFreq", "Puls-Dichte", 0.5, 5, 0.05],
    ["pole", "Polglühen", 0, 3, 0.01],
    ["ringFreq", "Ringdichte", 5, 40, 0.5],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  bird: [
    ["grain", "Körnung", 5, 60, 0.5],
    ["contrast", "Kontrast", 0, 1, 0.01],
    ["driftRicht", "Noise-Richtung °", 0, 360, 1],
    ["driftTempo", "Noise-Drift", 0, 2, 0.01],
    ["driftVertikal", "Drift vertikal", -1, 1, 0.01],
    ["stretch", "Anisotropie", 0.3, 3, 0.01],
    ["blobSchwelle", "Muster-Schwelle", 0, 0.8, 0.01],
    ["breathe", "Atmen", 0, 3, 0.01],
    ["ring", "Farbring", 0, 1, 0.01],
    ["sued", "Süd-Fleck", 0, 1.5, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  spectrum: [
    ["rings", "Ringdichte", 6, 80, 1],
    ["ringStaerke", "Ring-Stärke", 0, 3, 0.01],
    ["pole", "Polglühen", 0, 3, 0.01],
    ["zenit", "Zenit-Dunkel", 0, 1, 0.01],
    ["bleiche", "Ost/West-Bleiche", 0, 1, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  filings: [
    ["density", "Filamentdichte", 2, 30, 0.5],
    ["strength", "Stärke", 0, 1.5, 0.01],
    ["streck", "Streckung", 0.5, 6, 0.05],
    ["schwelle", "Dichte-Schwelle", 0.2, 0.7, 0.01],
    ["pole", "Polglühen", 0, 2, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  moire: [
    ["freq", "Wellendichte", 5, 80, 0.5],
    ["versatz", "Achsen-Versatz", 0, 0.3, 0.005],
    ["kontrast", "Kontrast", 0, 2, 0.01],
    ["grundhelligkeit", "Grundhelligkeit", 0, 2, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  plasma: [
    ["fluss", "Fluss-Tempo", 0, 3, 0.01],
    ["turbulenz", "Turbulenz", 0, 3, 0.01],
    ["dichte", "Strom-Dichte", 1, 12, 0.1],
    ["hell", "Helligkeit", 0, 3, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  polar: [
    ["staerke", "Stärke", 0, 2, 0.01],
    ["groesse", "Größe", 0.5, 3, 0.01],
    ["rotation", "Rotation °", 0, 360, 1],
    ["tempo", "Eigenrotation", 0, 1, 0.005],
    ["sued", "Süd-Spiegelung", 0, 1, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
  birdspec: [
    ["grund", "Grund-Rauschen", 0, 1, 0.01],
    ["polV", "Pol-Verstärkung", 0, 3, 0.01],
    ["polBreite", "Polzonen-Enge", 0.5, 8, 0.1],
    ["grain", "Körnung", 5, 60, 0.5],
    ["contrast", "Kontrast", 0, 1, 0.01],
    ["schimmer", "Schimmer", 0, 2, 0.01],
    ["breathe", "Atmen", 0, 3, 0.01],
    ["speed", "Tempo", 0, 3, 0.01],
  ],
};

function buildControls(params: Map<string, AnyUniform>): SensePanelDescriptor {
  const scalarGet = (key: string) => (): number => {
    const u = params.get(key);
    return u && typeof u.value === "number" ? u.value : 0;
  };
  const colorGet = (key: string) => (): string => {
    const value: unknown = params.get(key)?.value;
    return value instanceof Color ? `#${value.getHexString()}` : "#000000";
  };

  const controls: SensePanelDescriptor["controls"] = [
    // Field axis in degrees (the module converts, see the param routing below).
    {
      type: "range",
      key: "declDeg",
      label: "Deklination °",
      min: -180,
      max: 180,
      step: 0.5,
      digits: 1,
      get: () => deg(field.decl.value),
    },
    {
      type: "range",
      key: "elevDeg",
      label: "Achsen-Höhe °",
      min: -85,
      max: 85,
      step: 0.5,
      digits: 1,
      get: () => deg(field.elev.value),
    },
    {
      type: "range",
      key: "speed",
      label: "Tempo (global)",
      min: 0,
      max: 3,
      step: 0.01,
      get: scalarGet("speed"),
    },
  ];

  for (const mode of MODES) {
    controls.push({
      type: "range",
      key: `weight.${mode.key}`,
      label: `Mix · ${mode.name}`,
      min: 0,
      max: 1,
      step: 0.01,
      get: scalarGet(`weight.${mode.key}`),
    });
  }
  for (const mode of MODES) {
    for (const [param, label, min, max, step] of MODE_SLIDERS[mode.key]) {
      controls.push({
        type: "range",
        key: `${mode.key}.${param}`,
        label: `${mode.name} · ${label}`,
        min,
        max,
        step,
        get: scalarGet(`${mode.key}.${param}`),
      });
    }
    for (const [param, u] of Object.entries(modeU[mode.key])) {
      const value: unknown = u.value;
      if (value instanceof Color) {
        controls.push({
          type: "color",
          key: `${mode.key}.${param}`,
          label: `${mode.name} · ${param}`,
          get: colorGet(`${mode.key}.${param}`),
        });
      }
    }
  }

  return {
    key: "magnetfeld",
    description:
      "Der Himmel zeigt das Erdmagnetfeld: 9 mischbare Visualisierungen um eine gemeinsame Feldachse. Deklination/Achsen-Höhe = Lage des magnetischen Nordpunkts.",
    controls,
  };
}

export function createMagnetfeldSense(scene: THREE.Scene, bus: Bus): MagnetfeldSense {
  const params = buildParamRegistry();

  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 64, 32), createSkyMaterial());
  dome.frustumCulled = false;
  dome.visible = false;
  dome.renderOrder = -1; // behind everything transparent
  scene.add(dome);

  let target = signals.sense.magnetfeld.peek();
  const offSignal = signals.sense.magnetfeld.subscribe((v) => {
    target = v;
  });

  const offParams = bus.on("sense:param", (payload) => {
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = new Map<string, unknown>(Object.entries(payload));
    if (p.get("id") !== "magnetfeld") {
      return;
    }
    const key = p.get("key");
    const value = p.get("value");
    if (typeof key !== "string") {
      return;
    }
    // Degree convenience keys from the UI → radians on the field uniforms.
    if (key === "declDeg" && typeof value === "number") {
      field.decl.value = rad(value);
      return;
    }
    if (key === "elevDeg" && typeof value === "number") {
      field.elev.value = rad(value);
      return;
    }
    const u = params.get(key);
    if (!u) {
      return;
    }
    if (typeof value === "number" && typeof u.value === "number") {
      u.value = value;
    } else if (typeof value === "string" && u.value instanceof Color) {
      u.value.set(value);
    }
  });

  const pose = signals.playerPose.peek();

  return {
    controls: buildControls(params),
    setModeWeight(mode: ModeKey, weight: number): void {
      weights[mode].value = weight;
    },
    update(dt: number): void {
      uSkyTime.value = signals.time.peek();
      const current = uVisibility.value;
      const delta = target - current;
      if (delta !== 0) {
        const step = Math.min(Math.abs(delta), dt / FADE_SECONDS) * Math.sign(delta);
        uVisibility.value = current + step;
      }
      dome.visible = uVisibility.value > 0.001;
      if (dome.visible) {
        dome.position.set(pose.x, pose.y, pose.z);
      }
    },
    dispose(): void {
      offSignal();
      offParams();
      dome.removeFromParent();
      dome.geometry.dispose();
      if (dome.material instanceof THREE.Material) {
        dome.material.dispose();
      }
    },
  };
}
