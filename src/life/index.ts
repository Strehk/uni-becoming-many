// ── Becoming Many — Life ───────────────────────────────────────
//
// createLife(opts) → Life: the world's flora, as instanced Species entities that
// stream with the terrain and read the signal substrate.
//
// Wiring, in the shape the rest of the app already uses:
//   - terrain calls `onChunkBuilt`  → scatter, append instances, arm proximity
//   - terrain calls `onChunkDisposed` → remove the chunk's instances, disarm
//   - main.ts calls `update(dt)`    → pump signals into the shared uniforms
//
// Life is a pure CONSUMER of signals: it reads `time`, `unrest`, `intensity`,
// `activeSense`, and `playerPose`, and writes none of them. It emits no bus events.
// Per the substrate's perf law it `peek()`s in the frame loop and only `subscribe()`s
// to `activeSense`, which changes at human rate.

import * as THREE from "three/webgpu";
import type { KitUniforms } from "../render/uniforms.ts";
import type { SenseId } from "../senses/index.ts";
import { signals } from "../signals/index.ts";
import type { ChunkBuiltInfo, ChunkCell } from "../terrain/index.ts";
import { makeHeightEntry } from "../terrain/index.ts";
import { disposeFloraParts, loadFloraParts } from "./assets.ts";
import { SpeciesInstances } from "./instancing.ts";
import { watchChunkProximity } from "./proximity.ts";
import { biomeAffinityTable, scatterChunk } from "./scatter.ts";
import { SPECIES, SPECIES_IDS } from "./species.ts";
import { BIOLUMINESCENCE_BY_SENSE, createLifeUniforms } from "./uniforms.ts";

/**
 * Max chunks that can be live at once — the packed instance buffers are sized for
 * this worst case. Terrain builds within `buildRadius` (2) but only disposes beyond
 * `keepRadius` (3), so up to (2·3+1)² = 49 chunks coexist. Only the instances those
 * chunks actually placed are drawn (packed), not the capacity.
 */
const MAX_LIVE_CHUNKS = 49;

/** Seconds for `bioluminescence` to reach a new sense's target. Matches SenseManager. */
const BIOLUMINESCENCE_EASE = 4.5;

/** How hard authored unrest drives the wind: swayStrength ∈ [0.5, 2.0]. */
const SWAY_BASE = 0.5;
const SWAY_GAIN = 1.5;

export interface CreateLifeOptions {
  scene: THREE.Scene;
  /** The live sense uniforms — the same set the terrain wears. */
  uniforms: KitUniforms;
}

export interface Life {
  /** Parent of every species mesh; added to the scene on creation. */
  readonly group: THREE.Group;
  /** Hand to `createTerrainWorld({ onChunkBuilt })`. */
  onChunkBuilt(info: ChunkBuiltInfo): void;
  /** Hand to `createTerrainWorld({ onChunkDisposed })`. */
  onChunkDisposed(cell: ChunkCell): void;
  /** Advance the uniforms one frame. Call after `world.update(...)`. */
  update(dt: number): void;
  dispose(): void;
}

interface LiveChunk {
  /** Tears down this chunk's `bus.when` crossing. */
  unwatch: () => void;
}

const key = (gridX: number, gridZ: number): string => `${gridX},${gridZ}`;

/** Create the flora world and add its group to the scene. Async: the GLBs must land
 *  before any chunk can be populated. */
export async function createLife(opts: CreateLifeOptions): Promise<Life> {
  const group = new THREE.Group();
  opts.scene.add(group);

  const life = createLifeUniforms();
  const parts = await loadFloraParts();

  // One instancer + one affinity table per species, in the registry's stable order
  // (the order is also the PRNG salt, so it must not be re-derived elsewhere).
  const species = SPECIES_IDS.map((id) => {
    const def = SPECIES[id];
    const partList = parts.get(id);
    if (!partList) throw new Error(`[life] no geometry loaded for species "${id}"`);
    const instances = new SpeciesInstances(def, partList, MAX_LIVE_CHUNKS, opts.uniforms, life);
    for (const mesh of instances.meshes) group.add(mesh);
    return { def, instances, affinity: biomeAffinityTable(def) };
  });

  const liveChunks = new Map<string, LiveChunk>();

  // ── Bioluminescence follows the active sense (event-rate → subscribe is right) ──
  let glowTarget = BIOLUMINESCENCE_BY_SENSE[signals.activeSense.peek()] ?? 0;
  life.bioluminescence.value = glowTarget;
  const unsubscribeSense = signals.activeSense.subscribe((id: SenseId | "none") => {
    glowTarget = BIOLUMINESCENCE_BY_SENSE[id] ?? 0;
  });

  return {
    group,

    onChunkBuilt(info: ChunkBuiltInfo): void {
      const k = key(info.gridX, info.gridZ);
      if (liveChunks.has(k)) return; // already populated

      // The exact grid the mesh was built from → flora stands on the rendered surface.
      const entry = makeHeightEntry(info.gridX, info.gridZ, info.chunkSize, info.heightGrid);

      for (const [index, s] of species.entries()) {
        const block = scatterChunk(info, entry, s.def, s.affinity, index);
        s.instances.addChunk(k, block);
      }

      const centreX = (info.gridX + 0.5) * info.chunkSize;
      const centreZ = (info.gridZ + 0.5) * info.chunkSize;
      const unwatch = watchChunkProximity(centreX, centreZ, info.chunkSize, () => {
        const at = signals.time.peek();
        for (const s of species) s.instances.awakenChunk(k, at);
      });

      liveChunks.set(k, { unwatch });
    },

    onChunkDisposed(cell: ChunkCell): void {
      const k = key(cell.gridX, cell.gridZ);
      const live = liveChunks.get(k);
      if (!live) return;

      live.unwatch();
      for (const s of species) s.instances.removeChunk(k);
      liveChunks.delete(k);
    },

    update(dt: number): void {
      // peek() in the hot path — never subscribe to per-frame signals.
      life.clock.value = signals.time.peek();
      life.swayStrength.value = SWAY_BASE + signals.unrest.peek() * SWAY_GAIN;
      life.emissiveGain.value = signals.intensity.peek();

      // Frame-rate-independent ease toward the active sense's glow.
      const k = 1 - Math.exp((-dt * 3) / BIOLUMINESCENCE_EASE);
      const current = life.bioluminescence.value;
      life.bioluminescence.value = current + (glowTarget - current) * k;
    },

    dispose(): void {
      unsubscribeSense();
      for (const live of liveChunks.values()) live.unwatch();
      liveChunks.clear();
      for (const s of species) s.instances.dispose();
      disposeFloraParts(parts);
      group.removeFromParent();
    },
  };
}

export type { SpeciesDef, SpeciesId } from "./species.ts";
export { SPECIES, SPECIES_IDS } from "./species.ts";
