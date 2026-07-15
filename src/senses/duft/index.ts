// ── Duft sense — public facade + signal coupling ───────────────
//
// Owns the GPU scent field and anchors it to the streamed terrain:
//
//   - Scent zones are scattered PROCEDURALLY onto the terrain around the player
//     (height/slope-weighted plant guesses: flowers & lavender on low flats, herbs
//     and deciduous "crown blobs" mid-slope, pines higher up). When the player flies
//     more than ~96 m from the field's anchor, the field re-anchors: zones + grid
//     buffers are rewritten in place and the particles reseed — no pipeline rebuild.
//   - `signals.sense.duft` eases `u.fade` (sprite opacity); at 0 the field's compute
//     is skipped entirely and the sprites are hidden.
//   - `u.delta`/`u.time` follow the clock spine (pause/seek/timeScale reach the wind).
//   - `sense:param {id:"duft", key, value}` bus commands write every prototype
//     dev-tool parameter (wind, particles, per-type intensity, performance).

import * as THREE from "three/webgpu";
import type { SensePanelDescriptor } from "../../dev-console/sense-controls.ts";
import type { Bus } from "../../signals/index.ts";
import { signals } from "../../signals/index.ts";
import { SCENT_TYPES, getTypeIntensity, setTypeIntensity, u } from "./params.ts";
import { ScentField, type ScentZone } from "./scent-field.ts";

/** Field radius around the anchor (m). */
const FIELD_RADIUS = 120;
/** Re-anchor when the player is farther than this from the anchor (m). */
const REANCHOR_DIST = 96;
/** Seconds the layer takes to fade fully in/out. */
const FADE_SECONDS = 2.5;
/** How many plant spots the generator tries to place per anchor. */
const PLANT_SPOTS = 90;

/** Ground-height source (world.groundHeightAt) — null over unloaded chunks. */
export type GroundSource = (x: number, z: number) => number | null;

/** Water lookup (life.isWaterAt) — keeps guessed scent plants off lakes/rivers. */
export type WaterSource = (x: number, z: number) => boolean;

/** Optional zone source fed from the ACTUAL placed flora (life.scentSpotsAround,
 *  adapted in main.ts): given the new anchor, return anchor-LOCAL scent zones.
 *  An empty answer falls back to the procedural generator (flora not streamed yet). */
export type ZoneSource = (ax: number, ay: number, az: number, radius: number) => ScentZone[];

export interface DuftSense {
  readonly controls: SensePanelDescriptor;
  update(dt: number): void;
  dispose(): void;
}

/** Deterministic-ish plant scatter on the terrain around (ax, az). Local coords. */
function generateZones(
  ax: number,
  ay: number,
  az: number,
  ground: GroundSource,
  waterAt?: WaterSource,
): ScentZone[] {
  const zones: ScentZone[] = [];
  for (let i = 0; i < PLANT_SPOTS && zones.length < 180; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (FIELD_RADIUS - 6);
    const wx = ax + Math.cos(ang) * r;
    const wz = az + Math.sin(ang) * r;
    const h = ground(wx, wz);
    if (h === null) {
      continue;
    }
    if (waterAt?.(wx, wz)) {
      continue; // no flowering plants on lakes / rivers / the sea
    }
    // Local slope estimate from two nearby samples.
    const hx = ground(wx + 4, wz);
    const hz = ground(wx, wz + 4);
    if (hx === null || hz === null) {
      continue;
    }
    const slope = Math.max(Math.abs(hx - h), Math.abs(hz - h)) / 4;
    if (slope > 0.9) {
      continue; // cliffs carry no flowering plants
    }
    const rel = h - ay; // height relative to the anchor's ground
    const pick = Math.random();
    const lx = wx - ax;
    const lz = wz - az;
    const ly = h - ay;

    if (rel > 14 || (rel > 6 && pick < 0.5)) {
      // pines on the heights (resinous)
      zones.push({ x: lx, y: ly + 2.5, z: lz, radius: 2.6, type: 3 });
    } else if (slope < 0.18 && pick < 0.35) {
      // meadow flowers on low flats
      zones.push({ x: lx, y: ly + 0.7, z: lz, radius: 1.6, type: 0 });
    } else if (slope < 0.18 && pick < 0.55) {
      // lavender patches
      zones.push({ x: lx, y: ly + 0.6, z: lz, radius: 1.9, type: 1 });
    } else if (pick < 0.75) {
      // herb bushes on mid slopes
      zones.push({ x: lx, y: ly + 1.0, z: lz, radius: 1.7, type: 4 });
    } else {
      // deciduous tree: several crown blobs spread over the canopy (honey-like)
      const blobs = 3 + Math.floor(Math.random() * 3);
      for (let b = 0; b < blobs; b++) {
        zones.push({
          x: lx + (Math.random() - 0.5) * 4,
          y: ly + 4.5 + Math.random() * 3.5,
          z: lz + (Math.random() - 0.5) * 4,
          radius: 1.8 + Math.random() * 1.2,
          type: 2,
        });
      }
    }
  }
  return zones;
}

function buildControls(field: ScentField): SensePanelDescriptor {
  const num = (uni: { value: unknown }) => (): number =>
    typeof uni.value === "number" ? uni.value : 0;
  const controls: SensePanelDescriptor["controls"] = [
    // Wind
    {
      type: "range",
      key: "windSpeed",
      label: "Wind · Stärke",
      min: 0,
      max: 8,
      step: 0.05,
      get: num(u.windSpeed),
    },
    {
      type: "range",
      key: "windDirDeg",
      label: "Wind · Richtung °",
      min: 0,
      max: 360,
      step: 1,
      digits: 0,
      get: () =>
        ((typeof u.windDirRad.value === "number" ? u.windDirRad.value : 0) * 180) / Math.PI,
    },
    {
      type: "range",
      key: "gust",
      label: "Wind · Böen",
      min: 0,
      max: 2,
      step: 0.01,
      get: num(u.gust),
    },
    {
      type: "range",
      key: "gustFreq",
      label: "Wind · Böen-Frequenz",
      min: 0,
      max: 2,
      step: 0.01,
      get: num(u.gustFreq),
    },
    {
      type: "range",
      key: "turbulence",
      label: "Wind · Turbulenz",
      min: 0,
      max: 6,
      step: 0.05,
      get: num(u.turbulence),
    },
    {
      type: "range",
      key: "noiseScale",
      label: "Wind · Wirbelgröße",
      min: 0.02,
      max: 1,
      step: 0.01,
      get: num(u.noiseScale),
    },
    {
      type: "range",
      key: "noiseSpeed",
      label: "Wind · Wirbeltempo",
      min: 0,
      max: 2,
      step: 0.01,
      get: num(u.noiseSpeed),
    },
    {
      type: "range",
      key: "rise",
      label: "Wind · Auftrieb",
      min: -0.5,
      max: 1,
      step: 0.01,
      get: num(u.rise),
    },
    {
      type: "range",
      key: "spread",
      label: "Wind · Streuung",
      min: 0,
      max: 2,
      step: 0.01,
      get: num(u.spread),
    },
    // Scent & air
    {
      type: "range",
      key: "count",
      label: "Partikelanzahl",
      min: 20_000,
      max: 400_000,
      step: 10_000,
      digits: 0,
      get: () => field.count,
    },
    {
      type: "range",
      key: "size",
      label: "Partikelgröße",
      min: 0.05,
      max: 1.2,
      step: 0.01,
      get: num(u.size),
    },
    {
      type: "range",
      key: "intensity",
      label: "Deckkraft",
      min: 0,
      max: 1.5,
      step: 0.01,
      get: num(u.intensity),
    },
    {
      type: "range",
      key: "pickup",
      label: "Aufnahme-Rate",
      min: 0,
      max: 20,
      step: 0.1,
      get: num(u.pickup),
    },
    {
      type: "range",
      key: "evaporate",
      label: "Verflüchtigung (s)",
      min: 0.5,
      max: 30,
      step: 0.5,
      digits: 1,
      get: num(u.evaporate),
    },
    {
      type: "range",
      key: "spawnRadius",
      label: "Duftzonen-Radius ×",
      min: 0.2,
      max: 4,
      step: 0.05,
      get: num(u.spawnRadius),
    },
    {
      type: "range",
      key: "airOpacity",
      label: "Luft sichtbar",
      min: 0,
      max: 0.06,
      step: 0.001,
      digits: 3,
      get: num(u.airOpacity),
    },
    {
      type: "range",
      key: "airHeight",
      label: "Luftschicht-Höhe (m)",
      min: 2,
      max: 30,
      step: 0.5,
      digits: 1,
      get: num(u.airHeight),
    },
    {
      type: "range",
      key: "airGround",
      label: "Bodennähe",
      min: 0.5,
      max: 6,
      step: 0.1,
      digits: 1,
      get: num(u.airGround),
    },
    {
      type: "check",
      key: "windOnly",
      label: "Nur Wind zeigen",
      get: () => (typeof u.windOnly.value === "number" ? u.windOnly.value : 0) > 0.5,
    },
    { type: "check", key: "additive", label: "Additives Leuchten", get: () => false },
  ];
  // Per scent type intensity
  SCENT_TYPES.forEach((t, i) => {
    controls.push({
      type: "range",
      key: `typeIntensity.${i}`,
      label: `Duft · ${t.name}`,
      min: 0,
      max: 3,
      step: 0.05,
      get: () => getTypeIntensity(i),
    });
  });
  // Performance
  controls.push(
    {
      type: "check",
      key: "cheapNoise",
      label: "Einfache Turbulenz",
      get: () => (typeof u.cheapNoise.value === "number" ? u.cheapNoise.value : 0) > 0.5,
    },
    {
      type: "range",
      key: "pickupStride",
      label: "Duft-Update (jeden N.)",
      min: 1,
      max: 4,
      step: 1,
      digits: 0,
      get: num(u.pickupStride),
    },
    {
      type: "range",
      key: "cullDist",
      label: "Fern-Culling (m)",
      min: 40,
      max: 400,
      step: 5,
      digits: 0,
      get: num(u.cullDist),
    },
    {
      type: "check",
      key: "compaction",
      label: "GPU-Kompaktierung",
      get: () => field.compactionEnabled,
    },
  );
  return {
    key: "duft",
    description:
      "Chemische Wahrnehmung: die Luft trägt sichtbare Duftfahnen. Partikel nehmen in Duftzonen der (prozeduralen) Vegetation Farbe auf und verwehen im Wind.",
    controls,
  };
}

export function createDuftSense(
  scene: THREE.Scene,
  bus: Bus,
  rendererInstance: THREE.WebGPURenderer,
  ground: GroundSource,
  zoneSource?: ZoneSource,
  waterAt?: WaterSource,
): DuftSense {
  const field = new ScentField({ fieldRadius: FIELD_RADIUS, initialCount: 400_000 });
  scene.add(field.object);
  field.object.visible = false;

  let anchor: { x: number; y: number; z: number } | null = null;
  let target = signals.sense.duft.peek();
  let frame = 0;

  // ── Duftzonen-Debugansicht: one wireframe sphere per zone, type-coloured. ──
  let showZones = false;
  let zoneViz: THREE.InstancedMesh | null = null;
  let lastZones: readonly ScentZone[] = [];

  const disposeZoneViz = (): void => {
    if (!zoneViz) return;
    zoneViz.removeFromParent();
    zoneViz.geometry.dispose();
    (zoneViz.material as THREE.Material).dispose();
    zoneViz = null;
  };

  const rebuildZoneViz = (): void => {
    disposeZoneViz();
    if (!showZones || !anchor || lastZones.length === 0) return;

    const geometry = new THREE.SphereGeometry(1, 12, 8);
    const material = new THREE.MeshBasicNodeMaterial();
    material.wireframe = true;
    material.transparent = true;
    material.opacity = 0.3;
    material.depthWrite = false;

    const mesh = new THREE.InstancedMesh(geometry, material, lastZones.length);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const spawnRadius = typeof u.spawnRadius.value === "number" ? u.spawnRadius.value : 1;
    for (const [i, zone] of lastZones.entries()) {
      const r = Math.max(0.1, zone.radius * spawnRadius);
      m.makeScale(r, r, r);
      m.setPosition(anchor.x + zone.x, anchor.y + zone.y, anchor.z + zone.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(SCENT_TYPES[zone.type]?.color ?? 0xffffff));
    }
    scene.add(mesh);
    zoneViz = mesh;
  };

  const offSignal = signals.sense.duft.subscribe((v) => {
    target = v;
  });

  const reanchor = (px: number, pz: number): boolean => {
    const gy = ground(px, pz);
    if (gy === null) {
      return false; // terrain not streamed yet — try again next frame
    }
    anchor = { x: px, y: gy, z: pz };
    field.setCenter(px, gy, pz);
    // Real flora first: zones from the actually-placed plants around the anchor.
    // Falls back to the procedural guesser while the flora is still streaming in.
    const grown = zoneSource?.(px, gy, pz, FIELD_RADIUS - 6) ?? [];
    lastZones = grown.length > 0 ? grown : generateZones(px, gy, pz, ground, waterAt);
    field.setZones(lastZones);
    field.requestReseed();
    rebuildZoneViz();
    return true;
  };

  const offParams = bus.on("sense:param", (payload) => {
    if (typeof payload !== "object" || payload === null) {
      return;
    }
    const p = new Map<string, unknown>(Object.entries(payload));
    if (p.get("id") !== "duft") {
      return;
    }
    const key = p.get("key");
    const value = p.get("value");
    if (typeof key !== "string") {
      return;
    }
    if (key === "count" && typeof value === "number") {
      field.count = value;
      return;
    }
    if (key === "windDirDeg" && typeof value === "number") {
      u.windDirRad.value = (value * Math.PI) / 180;
      return;
    }
    if (key === "additive" && typeof value === "boolean") {
      field.setAdditive(value);
      return;
    }
    if (key === "compaction" && typeof value === "boolean") {
      field.setCompaction(value);
      return;
    }
    if (key === "showZones" && typeof value === "boolean") {
      showZones = value;
      rebuildZoneViz();
      return;
    }
    if (key.startsWith("typeIntensity.") && typeof value === "number") {
      setTypeIntensity(Number.parseInt(key.slice("typeIntensity.".length), 10), value);
      return;
    }
    const uniforms = new Map<string, { value: unknown }>(Object.entries(u));
    const uni = uniforms.get(key);
    if (!uni) {
      return;
    }
    if (typeof value === "number" && typeof uni.value === "number") {
      uni.value = value;
    } else if (typeof value === "boolean" && typeof uni.value === "number") {
      uni.value = value ? 1 : 0;
    }
  });

  const pose = signals.playerPose.peek();

  const controls = buildControls(field);
  controls.controls.push({
    type: "check",
    key: "showZones",
    label: "Duftzonen anzeigen",
    get: () => showZones,
  });

  return {
    controls,
    update(dt: number): void {
      // Ease the layer fade.
      const current = typeof u.fade.value === "number" ? u.fade.value : 0;
      const delta = target - current;
      if (delta !== 0) {
        const step = Math.min(Math.abs(delta), dt / FADE_SECONDS) * Math.sign(delta);
        u.fade.value = current + step;
      }
      const fade = typeof u.fade.value === "number" ? u.fade.value : 0;
      const active = fade > 0.001;
      field.object.visible = active;
      if (zoneViz) zoneViz.visible = active && showZones;
      if (!active) {
        return; // no compute while fully faded out — the field costs nothing
      }

      // Anchor management (initial + re-anchor when the player flew on).
      if (!anchor) {
        if (!reanchor(pose.x, pose.z)) {
          return;
        }
      } else {
        const dx = pose.x - anchor.x;
        const dz = pose.z - anchor.z;
        if (dx * dx + dz * dz > REANCHOR_DIST * REANCHOR_DIST) {
          reanchor(pose.x, pose.z);
        }
      }

      // Feed the spine into the GPU field, then run the simulation passes.
      u.delta.value = dt;
      u.time.value = signals.time.peek();
      frame =
        (frame + 1) %
        Math.max(
          1,
          Math.round(typeof u.pickupStride.value === "number" ? u.pickupStride.value : 1),
        );
      u.frameMod.value = frame;

      if (field.reseedRequested) {
        field.reseedRequested = false;
        void rendererInstance.computeAsync(field.reseedPass);
      }
      void rendererInstance.computeAsync(field.update);
      if (field.compactionEnabled) {
        void rendererInstance.computeAsync(field.compactClear);
        void rendererInstance.computeAsync(field.compact);
        field.syncDrawCount(rendererInstance);
      }
    },
    dispose(): void {
      offSignal();
      offParams();
      disposeZoneViz();
      field.dispose();
    },
  };
}
