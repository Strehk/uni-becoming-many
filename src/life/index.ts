// ── Becoming Many — Life ───────────────────────────────────────
//
// createLife(opts) → Life: the world's flora, as instanced Species entities that
// stream with the terrain and read the signal substrate.
//
// Wiring, in the shape the rest of the app already uses:
//   - terrain calls `onChunkBuilt`  → scatter, append instances
//   - terrain calls `onChunkDisposed` → remove the chunk's instances
//   - main.ts calls `update(dt)`    → pump signals into the shared uniforms
//
// Life is a pure CONSUMER of signals: it reads `time`, `unrest`, `intensity`,
// `activeSense`, and `playerPose`, and writes none of them. It emits no bus events.
// Per the substrate's perf law it `peek()`s in the frame loop and only `subscribe()`s
// to `activeSense`, which changes at human rate.

import * as THREE from "three/webgpu";
import {
  DEFAULT_CONFIG,
  type FloraConfig,
  SPECIES_CATEGORY,
  effectiveCap,
  reserveCap,
} from "../flora-fauna/config.ts";
import type { KitUniforms } from "../render/uniforms.ts";
import type { SenseId } from "../senses/index.ts";
import { signals } from "../signals/index.ts";
import type { ChunkBuiltInfo, ChunkCell } from "../terrain/index.ts";
import { Biome, makeHeightEntry } from "../terrain/index.ts";
import { disposeFloraParts, loadFloraParts, loadFoliageAtlas } from "./assets.ts";
import { SpeciesInstances } from "./instancing.ts";
import type { FloraLayerCompositor } from "./material.ts";
import { type ScatterMods, biomeAffinityTable, scatterChunk } from "./scatter.ts";
import { SPECIES, SPECIES_IDS, type ScentKey, type SpeciesId } from "./species.ts";
import { BIOLUMINESCENCE_BY_SENSE, createLifeUniforms } from "./uniforms.ts";
import { setWoodlandConfig } from "./woodland.ts";

/**
 * Max chunks that can be live at once — the packed instance buffers are sized for
 * this worst case. Terrain builds within `buildRadius` (2) but only disposes beyond
 * `keepRadius` (3), so up to (2·3+1)² = 49 chunks coexist. Only the instances those
 * chunks actually placed are drawn (packed), not the capacity.
 */
const MAX_LIVE_CHUNKS = 49;

/** Seconds for `bioluminescence` to reach a new sense's target. Matches SenseManager. */
const BIOLUMINESCENCE_EASE = 4.5;

/** How hard authored unrest drives the wind: swayStrength ∈ [swayBase, +1.5]. */
const SWAY_GAIN = 1.5;

export interface CreateLifeOptions {
  scene: THREE.Scene;
  /** The live sense uniforms — the same set the terrain wears. */
  uniforms: KitUniforms;
  /** The shader-sense compositor (same object the terrain gets) — flora colour runs
   *  through the SAME sense layers, so e.g. echo reads plants as pure depth. */
  layers?: FloraLayerCompositor;
  /** Density / forest-shape / sway config. Defaults to `DEFAULT_CONFIG.flora`. */
  config?: FloraConfig;
}

/** One placed plant's scent emission, in WORLD coordinates. What the duft sense
 *  turns into a `ScentZone` (which is anchor-local and indexed) at wiring time. */
export interface ScentSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly type: ScentKey;
}

/** Cap on how many spots one query returns — matches the scent field's zone
 *  buffer capacity (maxZones 192); nearest spots win so the plume field stays
 *  centred on the player. */
const MAX_SCENT_SPOTS = 192;

/** Species at least this tall (metres, before scale jitter) get a SECOND scent
 *  spot high in the crown — one zone at `heightOffset` can't span a 9 m pine,
 *  and without it the treetops read scentless. */
const CROWN_SPOT_MIN_HEIGHT = 4;

export interface Life {
  /** Parent of every species mesh; added to the scene on creation. */
  readonly group: THREE.Group;
  /** Hand to `createTerrainWorld({ onChunkBuilt })`. */
  onChunkBuilt(info: ChunkBuiltInfo): void;
  /** Hand to `createTerrainWorld({ onChunkDisposed })`. */
  onChunkDisposed(cell: ChunkCell): void;
  /** Advance the uniforms one frame. Call after `world.update(...)`. */
  update(dt: number): void;
  /** The scent emissions of actually-placed flora within `radius` of (x, z) —
   *  nearest first, capped. World coordinates; the duft coupling localizes them. */
  scentSpotsAround(x: number, z: number, radius: number): ScentSpot[];
  /** Apply new density / forest-shape / sway config. Re-scatters every live chunk
   *  in place (deterministic — same PRNG salt), so the change shows immediately
   *  without terrain regeneration. */
  applyConfig(config: FloraConfig): void;
  dispose(): void;
}

const key = (gridX: number, gridZ: number): string => `${gridX},${gridZ}`;

/** Create the flora world and add its group to the scene. Async: the GLBs must land
 *  before any chunk can be populated. */
export async function createLife(opts: CreateLifeOptions): Promise<Life> {
  const group = new THREE.Group();
  opts.scene.add(group);

  // Live flora config (density / forest shape / sway). Applied to the woodland
  // module + the effective-cap lookup below.
  let config: FloraConfig = opts.config ?? DEFAULT_CONFIG.flora;
  setWoodlandConfig(config);
  const capOf = new Map<SpeciesId, number>(SPECIES_IDS.map((id) => [id, effectiveCap(id, config)]));

  /** The species' biome-affinity table with the config's biome-specific extras
   *  folded in (flowerMeadow/bushMeadow multiply the category's Grassland entry). */
  const affinityFor = (id: SpeciesId): Float32Array => {
    const table = biomeAffinityTable(SPECIES[id]);
    const category = SPECIES_CATEGORY[id];
    const meadowMul =
      category === "flower"
        ? config.flowerMeadow
        : category === "undergrowth"
          ? config.bushMeadow
          : 1;
    if (meadowMul !== 1) {
      table[Biome.Grassland] = (table[Biome.Grassland] ?? 0) * meadowMul;
    }
    return table;
  };

  /** Config-driven scatter modifiers per species category: trees get size mean /
   *  variance / young skew, rocks the slope preference, understorey categories
   *  their clump fields (independent seeds so thickets ≠ flower patches ≠ rings). */
  const modsFor = (id: SpeciesId): ScatterMods => {
    const category = SPECIES_CATEGORY[id];
    if (category === "tree") {
      return {
        scaleMul: config.treeScale,
        scaleSpread: config.treeScaleVariance,
        youngBias: config.youngTrees,
      };
    }
    if (category === "rock") return { slopeBias: config.rockSlopeBias };
    if (category === "undergrowth" && config.bushCluster > 0) {
      return {
        cluster: { strength: config.bushCluster, size: config.bushClusterSize, seed: 0x7a11 },
      };
    }
    if (category === "flower" && config.flowerCluster > 0) {
      return {
        cluster: { strength: config.flowerCluster, size: config.flowerClusterSize, seed: 0x3b29 },
      };
    }
    if (category === "mushroom" && config.mushroomCluster > 0) {
      return {
        cluster: {
          strength: config.mushroomCluster,
          size: config.mushroomClusterSize,
          seed: 0x59c3,
        },
      };
    }
    return {};
  };

  const life = createLifeUniforms();
  const [parts, foliageAtlas] = await Promise.all([loadFloraParts(), loadFoliageAtlas()]);

  // One instancer + one affinity table per species, in the registry's stable order
  // (the order is also the PRNG salt, so it must not be re-derived elsewhere).
  // Buffers are sized for the density CEILING (reserveCap = baseCap × MAX_DENSITY),
  // so live density edits re-scatter into the same buffers without reallocation.
  const species = SPECIES_IDS.map((id) => {
    const def = SPECIES[id];
    const partList = parts.get(id);
    if (!partList) throw new Error(`[life] no geometry loaded for species "${id}"`);
    const instances = new SpeciesInstances(
      def,
      partList,
      MAX_LIVE_CHUNKS,
      opts.uniforms,
      life,
      opts.layers,
      foliageAtlas,
      reserveCap(id),
    );
    for (const mesh of instances.meshes) group.add(mesh);
    return { id, def, instances, affinity: affinityFor(id), mods: modsFor(id) };
  });

  const liveChunks = new Set<string>();
  // The chunk build infos, retained per live chunk — lets `applyConfig` re-scatter
  // every loaded chunk in place (with new caps) without asking terrain to rebuild.
  const chunkInfos = new Map<string, ChunkBuiltInfo>();
  // Scent emissions of placed flora, per chunk — fed to the duft sense via
  // `scentSpotsAround`, so plumes rise from actual trees/mushrooms, not guesses.
  const scentSpots = new Map<string, ScentSpot[]>();

  /** Scatter every species into one chunk's instance buffers and record its scent
   *  spots. Shared by the streaming hook and the live re-scatter (`applyConfig`). */
  const scatterInto = (k: string, info: ChunkBuiltInfo): void => {
    // The exact grid the mesh was built from → flora stands on the rendered surface.
    const entry = makeHeightEntry(info.gridX, info.gridZ, info.chunkSize, info.heightGrid);

    const spots: ScentSpot[] = [];
    for (const [index, s] of species.entries()) {
      const cap = capOf.get(s.id) ?? s.def.perChunkCap;
      const block = scatterChunk(info, entry, s.def, s.affinity, index, cap, s.mods);
      s.instances.addChunk(k, block);

      // Record the placed instances' scent emissions (matrix column 3 is the
      // instance translation — the plant's foot on the ground). Offsets and
      // radii scale with the instance (column 0's norm — scatter scales are
      // uniform), and tall species emit a second spot high in the crown so a
      // 9 m pine smells at the top, not only at the trunk.
      const scent = s.def.senses?.scent;
      if (scent) {
        for (let i = 0; i < block.count; i++) {
          const m = i * 16;
          const x = block.matrices[m + 12] ?? 0;
          const base = block.matrices[m + 13] ?? 0;
          const z = block.matrices[m + 14] ?? 0;
          const c0 = block.matrices[m] ?? 1;
          const c1 = block.matrices[m + 1] ?? 0;
          const c2 = block.matrices[m + 2] ?? 0;
          const scale = Math.sqrt(c0 * c0 + c1 * c1 + c2 * c2) || 1;

          spots.push({
            x,
            y: base + scent.heightOffset * scale,
            z,
            radius: scent.radius * scale,
            type: scent.type,
          });
          const height = s.def.targetHeight * scale;
          if (s.def.targetHeight >= CROWN_SPOT_MIN_HEIGHT) {
            spots.push({
              x,
              y: base + height * 0.8,
              z,
              radius: scent.radius * scale * 0.9,
              type: scent.type,
            });
          }
        }
      }
    }
    if (spots.length > 0) scentSpots.set(k, spots);
    else scentSpots.delete(k);
  };

  // ── Bioluminescence follows the active sense (event-rate → subscribe is right) ──
  let glowTarget = BIOLUMINESCENCE_BY_SENSE[signals.activeSense.peek()] ?? 0;
  life.bioluminescence.value = glowTarget;
  const unsubscribeSense = signals.activeSense.subscribe((id: SenseId | "none") => {
    glowTarget = BIOLUMINESCENCE_BY_SENSE[id] ?? 0;
  });

  // Structural sense changes (blend mode / layer order) rebuild the colorNode —
  // the same contract the terrain material follows.
  const unsubscribeLayers = opts.layers?.onStructureChange(() => {
    for (const s of species) s.instances.rewire();
  });

  return {
    group,

    onChunkBuilt(info: ChunkBuiltInfo): void {
      const k = key(info.gridX, info.gridZ);
      if (liveChunks.has(k)) return; // already populated
      chunkInfos.set(k, info);
      scatterInto(k, info);
      liveChunks.add(k);
    },

    onChunkDisposed(cell: ChunkCell): void {
      const k = key(cell.gridX, cell.gridZ);
      if (!liveChunks.has(k)) return;

      for (const s of species) s.instances.removeChunk(k);
      scentSpots.delete(k);
      chunkInfos.delete(k);
      liveChunks.delete(k);
    },

    scentSpotsAround(x: number, z: number, radius: number): ScentSpot[] {
      const r2 = radius * radius;
      const hits: { spot: ScentSpot; d2: number }[] = [];
      for (const spots of scentSpots.values()) {
        for (const spot of spots) {
          const dx = spot.x - x;
          const dz = spot.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) hits.push({ spot, d2 });
        }
      }
      hits.sort((a, b) => a.d2 - b.d2);
      return hits.slice(0, MAX_SCENT_SPOTS).map((h) => h.spot);
    },

    applyConfig(next: FloraConfig): void {
      config = next;
      setWoodlandConfig(config);
      for (const id of SPECIES_IDS) capOf.set(id, effectiveCap(id, config));
      for (const s of species) {
        s.affinity = affinityFor(s.id);
        s.mods = modsFor(s.id);
      }
      // Re-scatter every live chunk with the new caps. Clear packing first, then
      // replay in the retained chunk order — deterministic, no buffer realloc.
      for (const s of species) s.instances.clear();
      scentSpots.clear();
      for (const [k, info] of chunkInfos) scatterInto(k, info);
    },

    update(dt: number): void {
      // peek() in the hot path — never subscribe to per-frame signals.
      life.clock.value = signals.time.peek();
      life.swayStrength.value = config.swayStrength + signals.unrest.peek() * SWAY_GAIN;
      life.emissiveGain.value = signals.intensity.peek();

      // Frame-rate-independent ease toward the active sense's glow.
      const k = 1 - Math.exp((-dt * 3) / BIOLUMINESCENCE_EASE);
      const current = life.bioluminescence.value;
      life.bioluminescence.value = current + (glowTarget - current) * k;
    },

    dispose(): void {
      unsubscribeSense();
      unsubscribeLayers?.();
      liveChunks.clear();
      chunkInfos.clear();
      scentSpots.clear();
      for (const s of species) s.instances.dispose();
      disposeFloraParts(parts);
      foliageAtlas.dispose();
      group.removeFromParent();
    },
  };
}

export type { ScentKey, SpeciesDef, SpeciesId } from "./species.ts";
export { SPECIES, SPECIES_IDS } from "./species.ts";
