// ── Rundum sense — public facade + signal coupling ─────────────
//
// The 360° little-planet view is a VIEW MODE, not a colour layer: while
// `signals.sense.rundum` is up, the render pass is replaced by the cubemap
// capture + little-planet projection (via the renderer's render override).
// In XR the override is skipped by the renderer — the headset owns projection.
//
//   - `sense:param {id:"rundum", key, value}` adjusts zoom / exposure / contrast /
//     vignette / centerLift / yawOffset / far live.

import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { Renderer } from "../../renderer/index.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { type LittlePlanetOptions, LittlePlanetRenderer } from "./little-planet.ts";

export { LittlePlanetRenderer, LITTLE_PLANET_DEFAULTS } from "./little-planet.ts";
export type { LittlePlanetOptions, LittlePlanetRenderArgs } from "./little-planet.ts";

export interface RundumSense {
  readonly controls: SensePanelDescriptor;
  dispose(): void;
}

export function createRundumSense(renderer: Renderer, bus: Bus): RundumSense {
  const planet = new LittlePlanetRenderer();

  const apply = (active: boolean): void => {
    renderer.setRenderOverride(
      active
        ? () => {
            planet.render({
              renderer: renderer.instance,
              scene: renderer.scene,
              camera: renderer.camera,
            });
          }
        : null,
    );
  };

  const offSignal = signals.sense.rundum.subscribe((v) => apply(v > 0.5));
  apply(signals.sense.rundum.peek() > 0.5);

  const offParams = bus.on("sense:param", (payload) => {
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = new Map<string, unknown>(Object.entries(payload));
    if (p.get("id") !== "rundum") {
      return;
    }
    const key = p.get("key");
    const value = p.get("value");
    if (typeof key !== "string" || typeof value !== "number") {
      return;
    }
    if (key === "zoom") planet.setOptions({ zoom: value });
    else if (key === "exposure") planet.setOptions({ exposure: value });
    else if (key === "contrast") planet.setOptions({ contrast: value });
    else if (key === "vignette") planet.setOptions({ vignette: value });
    else if (key === "centerLift") planet.setOptions({ centerLift: value });
    else if (key === "yawOffsetDeg") planet.setOptions({ yawOffset: (value * Math.PI) / 180 });
    else if (key === "far") planet.setOptions({ far: value });
  });

  const o = (): Readonly<LittlePlanetOptions> => planet.currentOptions;

  return {
    controls: {
      key: "rundum",
      description:
        "360°-Rundumblick: die Welt wird als Little Planet projiziert — Rundum-Wahrnehmung als eigene Kameraprojektion (ersetzt den normalen Render-Pass).",
      controls: [
        {
          type: "range",
          key: "zoom",
          label: "Zoom",
          min: 0.4,
          max: 3,
          step: 0.01,
          get: () => o().zoom,
        },
        {
          type: "range",
          key: "exposure",
          label: "Belichtung",
          min: 0.2,
          max: 3,
          step: 0.01,
          get: () => o().exposure,
        },
        {
          type: "range",
          key: "contrast",
          label: "Kontrast",
          min: 0.5,
          max: 2,
          step: 0.01,
          get: () => o().contrast,
        },
        {
          type: "range",
          key: "vignette",
          label: "Vignette",
          min: 0,
          max: 1,
          step: 0.01,
          get: () => o().vignette,
        },
        {
          type: "range",
          key: "centerLift",
          label: "Zentrum anheben",
          min: -0.5,
          max: 0.5,
          step: 0.01,
          get: () => o().centerLift,
        },
        {
          type: "range",
          key: "yawOffsetDeg",
          label: "Yaw-Versatz °",
          min: -180,
          max: 180,
          step: 1,
          digits: 0,
          get: () => (o().yawOffset * 180) / Math.PI,
        },
        {
          type: "range",
          key: "far",
          label: "Sichtweite (m)",
          min: 100,
          max: 1500,
          step: 10,
          digits: 0,
          get: () => o().far,
        },
      ],
    },
    dispose(): void {
      offSignal();
      offParams();
      renderer.setRenderOverride(null);
      planet.dispose();
    },
  };
}
