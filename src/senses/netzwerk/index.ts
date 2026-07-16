// ── Netzwerk sense — public facade + signal coupling ───────────
//
// Wires the two networks onto the substrate:
//
//   - the **SwarmNetwork** reads the boids birds (creatures substrate) as moving
//     nodes — links + travelling signals update every frame while visible;
//   - the **RootsNetwork** grows a wave-function-collapsed root web from the
//     rooted plants (trees / bushes / mushrooms via `sources.rootAnchors`) and
//     rebuilds when the player travels or a structural option changes;
//   - `signals.sense.netzwerk` eases both `fade` uniforms; at 0 the groups are
//     hidden and nothing updates (zero cost);
//   - `sense:param {id:"netzwerk", key, value}` routes `swarm.<key>` /
//     `wurzel.<key>` option writes; structural root keys trigger a rebuild.

import type * as THREE from "three/webgpu";
import type { BirdActor } from "../../creatures/index.ts";
import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { RootAnchor } from "../../life/index.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { ROOTS_STRUCTURAL, RootsNetwork, type RootsOptions } from "./roots-network.ts";
import { SwarmNetwork, type SwarmNetworkOptions } from "./swarm-network.ts";

const FADE_SECONDS = 2.5;

/** While the root web found no plants yet (flora still streaming in), retry the
 *  build at most this often. */
const ROOTS_RETRY_SECONDS = 0.5;

export interface NetzwerkSources {
  readonly birds: readonly BirdActor[];
  /** Root points of placed flora around (x, z) — see `Life.rootAnchorsAround`. */
  rootAnchors(x: number, z: number, radius: number): readonly RootAnchor[];
  /** Terrain surface height (null outside loaded chunks) — the root strands hug it. */
  groundHeightAt(x: number, z: number): number | null;
  /** Water lookup (life.isWaterAt) — the root web never grows through lakes. */
  waterAt(x: number, z: number): boolean;
}

export interface NetzwerkSense {
  readonly controls: SensePanelDescriptor;
  update(dt: number): void;
  dispose(): void;
}

function buildControls(swarm: SwarmNetwork, roots: RootsNetwork): SensePanelDescriptor {
  const so = (): Readonly<SwarmNetworkOptions> => swarm.currentOptions;
  const ro = (): Readonly<RootsOptions> => roots.currentOptions;
  return {
    key: "netzwerk",
    description:
      "Kollektiv-Wahrnehmung: ein leuchtendes Kommunikationsnetz zwischen den Schwarmtieren und ein per Wave Function Collapse gewachsenes Wurzelgeflecht, das unter Bäumen, Büschen und Pilzen beginnt und alles verbindet.",
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
      // Roots — WFC layout
      {
        type: "range",
        key: "wurzel.radius",
        label: "Wurzeln · Reichweite",
        min: 40,
        max: 200,
        step: 5,
        digits: 0,
        get: () => ro().radius,
      },
      {
        type: "range",
        key: "wurzel.viewDistance",
        label: "Wurzeln · Sichtweite",
        min: 20,
        max: 250,
        step: 5,
        digits: 0,
        get: () => ro().viewDistance,
      },
      {
        type: "range",
        key: "wurzel.cellSize",
        label: "Wurzeln · Rasterweite",
        min: 3,
        max: 16,
        step: 0.5,
        digits: 1,
        get: () => ro().cellSize,
      },
      {
        type: "range",
        key: "wurzel.density",
        label: "Wurzeln · Dichte",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().density,
      },
      {
        type: "range",
        key: "wurzel.branchiness",
        label: "Wurzeln · Verästelung",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().branchiness,
      },
      {
        type: "range",
        key: "wurzel.tips",
        label: "Wurzeln · Wurzelspitzen",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().tips,
      },
      {
        type: "check",
        key: "wurzel.connectAll",
        label: "Wurzeln · Alles verbinden",
        get: () => ro().connectAll,
      },
      {
        type: "range",
        key: "wurzel.seed",
        label: "Wurzeln · Seed",
        min: 1,
        max: 99,
        step: 1,
        digits: 0,
        get: () => ro().seed,
      },
      // Roots — hubs per plant kind
      {
        type: "range",
        key: "wurzel.treeHub",
        label: "Wurzeln · Baum-Knoten",
        min: 0,
        max: 4,
        step: 1,
        digits: 0,
        get: () => ro().treeHub,
      },
      {
        type: "range",
        key: "wurzel.bushHub",
        label: "Wurzeln · Busch-Knoten",
        min: 0,
        max: 4,
        step: 1,
        digits: 0,
        get: () => ro().bushHub,
      },
      {
        type: "range",
        key: "wurzel.mushroomHub",
        label: "Wurzeln · Pilz-Knoten",
        min: 0,
        max: 4,
        step: 1,
        digits: 0,
        get: () => ro().mushroomHub,
      },
      // Roots — strand look
      {
        type: "range",
        key: "wurzel.strands",
        label: "Wurzeln · Stränge",
        min: 1,
        max: 5,
        step: 1,
        digits: 0,
        get: () => ro().strands,
      },
      {
        type: "range",
        key: "wurzel.strandSpread",
        label: "Wurzeln · Strangbreite",
        min: 0,
        max: 2,
        step: 0.05,
        get: () => ro().strandSpread,
      },
      {
        type: "range",
        key: "wurzel.wiggle",
        label: "Wurzeln · Gewundenheit",
        min: 0,
        max: 5,
        step: 0.1,
        digits: 1,
        get: () => ro().wiggle,
      },
      {
        type: "range",
        key: "wurzel.taper",
        label: "Wurzeln · Ausdünnung",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().taper,
      },
      {
        type: "range",
        key: "wurzel.depth",
        label: "Wurzeln · Tiefe",
        min: 0,
        max: 6,
        step: 0.1,
        digits: 1,
        get: () => ro().depth,
      },
      {
        type: "range",
        key: "wurzel.segments",
        label: "Wurzeln · Segmente",
        min: 4,
        max: 24,
        step: 1,
        digits: 0,
        get: () => ro().segments,
      },
      // Roots — glow
      {
        type: "range",
        key: "wurzel.baseAlpha",
        label: "Wurzeln · Grund-Alpha",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().baseAlpha,
      },
      {
        type: "range",
        key: "wurzel.hotspotAlpha",
        label: "Wurzeln · Hotspot-Alpha",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ro().hotspotAlpha,
      },
      {
        type: "range",
        key: "wurzel.hotspotStrength",
        label: "Wurzeln · Hotspot-Stärke",
        min: 0,
        max: 6,
        step: 0.05,
        get: () => ro().hotspotStrength,
      },
      {
        type: "range",
        key: "wurzel.hotspotSpeed",
        label: "Wurzeln · Hotspot-Tempo",
        min: 0,
        max: 12,
        step: 0.1,
        digits: 1,
        get: () => ro().hotspotSpeed,
      },
      {
        type: "color",
        key: "wurzel.baseColor",
        label: "Wurzeln · Grundfarbe",
        get: () => ro().baseColor,
      },
      {
        type: "color",
        key: "wurzel.hotspotColor",
        label: "Wurzeln · Hotspot-Farbe",
        get: () => ro().hotspotColor,
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

/** Typed routing of a `wurzel.<key>` param command onto the options object. */
function applyRootsOption(
  roots: RootsNetwork,
  key: string,
  value: string | number | boolean,
): void {
  if (typeof value === "number") {
    if (key === "radius") roots.setOptions({ radius: value });
    else if (key === "cellSize") roots.setOptions({ cellSize: value });
    else if (key === "density") roots.setOptions({ density: value });
    else if (key === "branchiness") roots.setOptions({ branchiness: value });
    else if (key === "tips") roots.setOptions({ tips: value });
    else if (key === "seed") roots.setOptions({ seed: Math.round(value) });
    else if (key === "treeHub") roots.setOptions({ treeHub: Math.round(value) });
    else if (key === "bushHub") roots.setOptions({ bushHub: Math.round(value) });
    else if (key === "mushroomHub") roots.setOptions({ mushroomHub: Math.round(value) });
    else if (key === "strands") roots.setOptions({ strands: Math.round(value) });
    else if (key === "strandSpread") roots.setOptions({ strandSpread: value });
    else if (key === "wiggle") roots.setOptions({ wiggle: value });
    else if (key === "taper") roots.setOptions({ taper: value });
    else if (key === "depth") roots.setOptions({ depth: value });
    else if (key === "viewDistance") roots.setOptions({ viewDistance: value });
    else if (key === "segments") roots.setOptions({ segments: Math.round(value) });
    else if (key === "baseAlpha") roots.setOptions({ baseAlpha: value });
    else if (key === "hotspotAlpha") roots.setOptions({ hotspotAlpha: value });
    else if (key === "hotspotStrength") roots.setOptions({ hotspotStrength: value });
    else if (key === "hotspotSpeed") roots.setOptions({ hotspotSpeed: value });
  } else if (typeof value === "boolean") {
    if (key === "connectAll") roots.setOptions({ connectAll: value });
  } else {
    if (key === "baseColor") roots.setOptions({ baseColor: value });
    else if (key === "hotspotColor") roots.setOptions({ hotspotColor: value });
  }
}

export function createNetzwerkSense(
  scene: THREE.Scene,
  bus: Bus,
  sources: NetzwerkSources,
): NetzwerkSense {
  const swarm = new SwarmNetwork({ maxNodes: 64 });
  const roots = new RootsNetwork(
    (x, z) => sources.groundHeightAt(x, z),
    (x, z, radius) => sources.rootAnchors(x, z, radius),
    (x, z) => sources.waterAt(x, z),
  );
  scene.add(swarm.group, roots.group);
  swarm.group.visible = false;
  roots.group.visible = false;

  let fade = 0;
  let target = signals.sense.netzwerk.peek();
  let rootsDirty = true;
  let retryTimer = 0;

  const offSignal = signals.sense.netzwerk.subscribe((v) => {
    target = v;
  });
  // Flora re-scatter (density edits etc.) moves the plants → re-grow the web.
  const offFlora = bus.on("flora-fauna:param", () => {
    rootsDirty = true;
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
    if (
      typeof key !== "string" ||
      (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean")
    ) {
      return;
    }
    if (key.startsWith("swarm.")) {
      if (typeof value !== "boolean") {
        applySwarmOption(swarm, key.slice("swarm.".length), value);
      }
    } else if (key.startsWith("wurzel.")) {
      const option = key.slice("wurzel.".length);
      applyRootsOption(roots, option, value);
      if (ROOTS_STRUCTURAL.has(option as keyof RootsOptions)) {
        rootsDirty = true;
      }
    }
  });

  return {
    controls: buildControls(swarm, roots),
    update(dt: number): void {
      const delta = target - fade;
      if (delta !== 0) {
        fade += Math.min(Math.abs(delta), dt / FADE_SECONDS) * Math.sign(delta);
      }
      swarm.fade.value = fade;
      roots.fade.value = fade;
      const active = fade > 0.001;
      swarm.group.visible = active;
      roots.group.visible = active;
      if (!active) {
        return;
      }

      // Root web upkeep: blocks are world-anchored and deterministic, so this
      // only adds/removes rim blocks while flying — the visible web never jumps.
      // `rootsDirty` (structural param / flora change) forces a fresh solve.
      const pose = signals.playerPose.peek();
      retryTimer += dt;
      let force = false;
      if (rootsDirty && retryTimer >= ROOTS_RETRY_SECONDS) {
        roots.invalidate();
        force = true;
      }
      const anchoredBlocks = roots.rebuildIfNeeded(pose.x, pose.z, force);
      if (anchoredBlocks >= 0) {
        retryTimer = 0;
        // Keep retrying while no plants were found (flora still streaming in).
        if (anchoredBlocks > 0) rootsDirty = false;
        else rootsDirty = true;
      }

      const elapsed = signals.time.peek();
      swarm.setNodes(sources.birds);
      swarm.update(dt, elapsed);
      roots.update(dt, elapsed, pose.x, pose.y, pose.z);
    },
    dispose(): void {
      offSignal();
      offFlora();
      offParams();
      swarm.dispose();
      roots.dispose();
    },
  };
}
