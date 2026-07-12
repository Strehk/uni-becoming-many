// ── Netzwerk sense — public facade + signal coupling ───────────
//
// Wires the two ported networks onto the substrate:
//
//   - the **SwarmNetwork** reads the boids birds (creatures substrate) as moving
//     nodes — links + travelling signals update every frame while visible;
//   - the **MyceliumNetwork** grows from the mushroom spawn points and rebuilds
//     whenever the creatures module re-scatters them (`creatures:mushrooms-changed`).
//   - `signals.sense.netzwerk` eases both `fade` uniforms; at 0 the groups are
//     hidden and nothing updates (zero cost).
//   - `sense:param {id:"netzwerk", key, value}` routes `swarm.<key>` / `myzel.<key>`
//     option writes; structural mycelium keys trigger a rebuild.

import type * as THREE from "three/webgpu";
import type { BirdActor } from "../../creatures/index.ts";
import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { MyceliumNetwork, type MyceliumOptions } from "./mycelium-network.ts";
import { SwarmNetwork, type SwarmNetworkOptions } from "./swarm-network.ts";

const FADE_SECONDS = 2.5;

/** Mycelium options whose change requires a geometry rebuild. */
const MYCELIUM_STRUCTURAL: ReadonlySet<string> = new Set([
  "radius",
  "neighbourLinks",
  "radialArms",
  "branchDepth",
  "segments",
  "maxDepth",
]);

export interface NetzwerkSources {
  readonly birds: readonly BirdActor[];
  readonly mushrooms: readonly THREE.Vector3[];
}

export interface NetzwerkSense {
  readonly controls: SensePanelDescriptor;
  update(dt: number): void;
  dispose(): void;
}

function buildControls(swarm: SwarmNetwork, mycelium: MyceliumNetwork): SensePanelDescriptor {
  const so = (): Readonly<SwarmNetworkOptions> => swarm.currentOptions;
  const mo = (): Readonly<MyceliumOptions> => mycelium.currentOptions;
  return {
    key: "netzwerk",
    description:
      "Kollektiv-Wahrnehmung: ein leuchtendes Kommunikationsnetz zwischen den Schwarmtieren und das pulsierende Myzel der Pilze im Boden.",
    controls: [
      // Swarm
      {
        type: "range",
        key: "swarm.networkIntensity",
        label: "Schwarm · Intensität",
        min: 0,
        max: 1.5,
        step: 0.01,
        get: () => so().networkIntensity,
      },
      {
        type: "range",
        key: "swarm.nearestLinks",
        label: "Schwarm · Links/Knoten",
        min: 1,
        max: 4,
        step: 1,
        digits: 0,
        get: () => so().nearestLinks,
      },
      {
        type: "range",
        key: "swarm.linkRadius",
        label: "Schwarm · Linkstärke",
        min: 0.02,
        max: 0.4,
        step: 0.01,
        get: () => so().linkRadius,
      },
      {
        type: "range",
        key: "swarm.glowRadius",
        label: "Schwarm · Glühstärke",
        min: 0.05,
        max: 1.2,
        step: 0.01,
        get: () => so().glowRadius,
      },
      {
        type: "range",
        key: "swarm.signalSpeed",
        label: "Schwarm · Signaltempo",
        min: 0,
        max: 8,
        step: 0.05,
        get: () => so().signalSpeed,
      },
      {
        type: "range",
        key: "swarm.signalSize",
        label: "Schwarm · Signalgröße",
        min: 0.2,
        max: 5,
        step: 0.1,
        digits: 1,
        get: () => so().signalSize,
      },
      {
        type: "range",
        key: "swarm.curveStrength",
        label: "Schwarm · Bogenstärke",
        min: 0,
        max: 0.15,
        step: 0.002,
        digits: 3,
        get: () => so().curveStrength,
      },
      {
        type: "color",
        key: "swarm.linkColor",
        label: "Schwarm · Linkfarbe",
        get: () => so().linkColor,
      },
      {
        type: "color",
        key: "swarm.glowColor",
        label: "Schwarm · Glühfarbe",
        get: () => so().glowColor,
      },
      {
        type: "color",
        key: "swarm.signalCoreColor",
        label: "Schwarm · Signal-Kern",
        get: () => so().signalCoreColor,
      },
      {
        type: "color",
        key: "swarm.signalHaloColor",
        label: "Schwarm · Signal-Halo",
        get: () => so().signalHaloColor,
      },
      // Mycelium
      {
        type: "range",
        key: "myzel.neighbourLinks",
        label: "Myzel · Nachbar-Links",
        min: 1,
        max: 8,
        step: 1,
        digits: 0,
        get: () => mo().neighbourLinks,
      },
      {
        type: "range",
        key: "myzel.radialArms",
        label: "Myzel · Radial-Arme",
        min: 0,
        max: 16,
        step: 1,
        digits: 0,
        get: () => mo().radialArms,
      },
      {
        type: "range",
        key: "myzel.branchDepth",
        label: "Myzel · Verzweigungstiefe",
        min: 0,
        max: 4,
        step: 1,
        digits: 0,
        get: () => mo().branchDepth,
      },
      {
        type: "range",
        key: "myzel.baseAlpha",
        label: "Myzel · Grund-Alpha",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => mo().baseAlpha,
      },
      {
        type: "range",
        key: "myzel.hotspotAlpha",
        label: "Myzel · Hotspot-Alpha",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => mo().hotspotAlpha,
      },
      {
        type: "range",
        key: "myzel.hotspotStrength",
        label: "Myzel · Hotspot-Stärke",
        min: 0,
        max: 6,
        step: 0.05,
        get: () => mo().hotspotStrength,
      },
      {
        type: "range",
        key: "myzel.hotspotSpeed",
        label: "Myzel · Hotspot-Tempo",
        min: 0,
        max: 12,
        step: 0.1,
        digits: 1,
        get: () => mo().hotspotSpeed,
      },
      {
        type: "color",
        key: "myzel.baseColor",
        label: "Myzel · Grundfarbe",
        get: () => mo().baseColor,
      },
      {
        type: "color",
        key: "myzel.hotspotColor",
        label: "Myzel · Hotspot-Farbe",
        get: () => mo().hotspotColor,
      },
    ],
  };
}

/** Typed routing of a `swarm.<key>` param command onto the options object. */
function applySwarmOption(swarm: SwarmNetwork, key: string, value: string | number): void {
  if (typeof value === "number") {
    if (key === "networkIntensity") swarm.setOptions({ networkIntensity: value });
    else if (key === "nearestLinks") swarm.setOptions({ nearestLinks: Math.round(value) });
    else if (key === "linkRadius") swarm.setOptions({ linkRadius: value });
    else if (key === "glowRadius") swarm.setOptions({ glowRadius: value });
    else if (key === "signalSpeed") swarm.setOptions({ signalSpeed: value });
    else if (key === "signalSize") swarm.setOptions({ signalSize: value });
    else if (key === "curveStrength") swarm.setOptions({ curveStrength: value });
  } else {
    if (key === "linkColor") swarm.setOptions({ linkColor: value });
    else if (key === "glowColor") swarm.setOptions({ glowColor: value });
    else if (key === "signalCoreColor") swarm.setOptions({ signalCoreColor: value });
    else if (key === "signalHaloColor") swarm.setOptions({ signalHaloColor: value });
  }
}

/** Typed routing of a `myzel.<key>` param command onto the options object. */
function applyMyceliumOption(mycelium: MyceliumNetwork, key: string, value: string | number): void {
  if (typeof value === "number") {
    if (key === "radius") mycelium.setOptions({ radius: value });
    else if (key === "neighbourLinks") mycelium.setOptions({ neighbourLinks: Math.round(value) });
    else if (key === "radialArms") mycelium.setOptions({ radialArms: Math.round(value) });
    else if (key === "branchDepth") mycelium.setOptions({ branchDepth: Math.round(value) });
    else if (key === "segments") mycelium.setOptions({ segments: Math.round(value) });
    else if (key === "maxDepth") mycelium.setOptions({ maxDepth: value });
    else if (key === "baseAlpha") mycelium.setOptions({ baseAlpha: value });
    else if (key === "hotspotAlpha") mycelium.setOptions({ hotspotAlpha: value });
    else if (key === "hotspotStrength") mycelium.setOptions({ hotspotStrength: value });
    else if (key === "hotspotSpeed") mycelium.setOptions({ hotspotSpeed: value });
  } else {
    if (key === "baseColor") mycelium.setOptions({ baseColor: value });
    else if (key === "hotspotColor") mycelium.setOptions({ hotspotColor: value });
  }
}

export function createNetzwerkSense(
  scene: THREE.Scene,
  bus: Bus,
  sources: NetzwerkSources,
): NetzwerkSense {
  const swarm = new SwarmNetwork({ maxNodes: 64 });
  const mycelium = new MyceliumNetwork({ radius: 120 });
  scene.add(swarm.group, mycelium.group);
  swarm.group.visible = false;
  mycelium.group.visible = false;

  let fade = 0;
  let target = signals.sense.netzwerk.peek();
  let myceliumDirty = true;

  const offSignal = signals.sense.netzwerk.subscribe((v) => {
    target = v;
  });
  const offMushrooms = bus.on("creatures:mushrooms-changed", () => {
    myceliumDirty = true;
  });

  const offParams = bus.on("sense:param", (payload) => {
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = new Map<string, unknown>(Object.entries(payload));
    if (p.get("id") !== "netzwerk") {
      return;
    }
    const key = p.get("key");
    const value = p.get("value");
    if (typeof key !== "string" || (typeof value !== "number" && typeof value !== "string")) {
      return;
    }
    if (key.startsWith("swarm.")) {
      applySwarmOption(swarm, key.slice("swarm.".length), value);
    } else if (key.startsWith("myzel.")) {
      const option = key.slice("myzel.".length);
      applyMyceliumOption(mycelium, option, value);
      if (MYCELIUM_STRUCTURAL.has(option)) {
        myceliumDirty = true;
      }
    }
  });

  return {
    controls: buildControls(swarm, mycelium),
    update(dt: number): void {
      const delta = target - fade;
      if (delta !== 0) {
        fade += Math.min(Math.abs(delta), dt / FADE_SECONDS) * Math.sign(delta);
      }
      swarm.fade.value = fade;
      mycelium.fade.value = fade;
      const active = fade > 0.001;
      swarm.group.visible = active;
      mycelium.group.visible = active;
      if (!active) {
        return;
      }

      if (myceliumDirty && sources.mushrooms.length > 0) {
        myceliumDirty = false;
        mycelium.setMushrooms(sources.mushrooms);
        mycelium.rebuild();
      }

      const elapsed = signals.time.peek();
      swarm.setNodes(sources.birds);
      swarm.update(dt, elapsed);
      mycelium.update(dt, elapsed);
    },
    dispose(): void {
      offSignal();
      offMushrooms();
      offParams();
      swarm.dispose();
      mycelium.dispose();
    },
  };
}
