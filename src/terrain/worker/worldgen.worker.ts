// ── Becoming Many — WorldGen Worker ────────────────────────────
//
// Runs the whole CPU generation pipeline off the main thread: per-chunk field/
// slope/water/biome maps → a detail layer baked into per-vertex arrays. A SINGLE
// dedicated worker (not a pool) so a future region LRU cache stays warm.
//
// Builds are serialized through a promise chain so the shared generator / detail
// generator never see interleaved config. The config travels on each build
// request; when its signature changes we clear the caches (= a live seed /
// amplitude / frequency switch). Imports NOTHING from three — the main thread
// wraps the returned arrays in a BufferGeometry.

/// <reference lib="webworker" />

import { downsampleFields } from "../gen/fields.downsample.ts";
import { TerrainDetailGenerator } from "../gen/height/TerrainDetailGenerator.ts";
import { TerrainSampler } from "../gen/height/TerrainSampler.ts";
import { buildChunkArrays } from "../gen/height/mesh.ts";
import type { GenParams } from "../gen/mapTypes.ts";
import { applyBiomeFrequencyParams, configToParams } from "../gen/params.ts";
import { buildWaterArrays } from "../gen/water/water-mesh.ts";
import { WorldMapGenerator } from "../gen/world/WorldMapGenerator.ts";
import type { TerrainConfig } from "../provider.ts";
import type {
  WorldgenBuildRequest,
  WorldgenBuildResult,
  WorldgenInbound,
  WorldgenOutbound,
} from "./worldgen-protocol.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorldgenOutbound, transfer: Transferable[]): void {
  scope.postMessage(message, transfer);
}

const gen = new WorldMapGenerator();
const INITIAL_CFG: TerrainConfig = { seed: 1337, amplitude: 1, frequency: 1, octaves: 4 };
let params: GenParams = configToParams(INITIAL_CFG);
let detail = new TerrainDetailGenerator(params);
let sig = JSON.stringify({ cfg: INITIAL_CFG, params: undefined });

/** Apply a (possibly new) config + GUI param overlay, clearing caches only when
 *  something changed. The overlay wins over configToParams. */
function ensureConfig(cfg: TerrainConfig, override?: Record<string, number>): void {
  const next = JSON.stringify({ cfg, params: override });
  if (next === sig) return;
  sig = next;
  params = applyBiomeFrequencyParams({ ...configToParams(cfg), ...(override ?? {}) });
  detail = new TerrainDetailGenerator(params);
  gen.clearCaches();
}

async function build(msg: WorldgenBuildRequest): Promise<void> {
  try {
    ensureConfig(msg.cfg, msg.params);
    // The streaming chunk size (world extent) is authoritative: the field maps are
    // 1 px per world unit, so params.chunkSize must equal the world-space tile size.
    params.chunkSize = msg.chunkSize;
    const chunk = await gen.generateChunk(msg.gridX, msg.gridZ, params);
    const sampler = new TerrainSampler(chunk);
    const { positions, normals, biome, colors, heightGrid } = buildChunkArrays(
      sampler,
      detail,
      params,
      msg.segments,
    );
    const water = buildWaterArrays(sampler, detail, params, msg.segments);
    // Placement layers for scatter consumers (src/life/). Cheap enough to ship every
    // build once coarsened; the raw per-pixel maps stay in the worker.
    const fields = downsampleFields(chunk);
    const result: WorldgenBuildResult = {
      type: "built",
      id: msg.id,
      gridX: msg.gridX,
      gridZ: msg.gridZ,
      positions,
      normals,
      biome,
      colors,
      heightGrid,
      fields,
      ...(water ? { waterPositions: water.positions, waterColors: water.colors } : {}),
    };
    const transfer: Transferable[] = [
      positions.buffer,
      normals.buffer,
      biome.buffer,
      colors.buffer,
      heightGrid.buffer,
      fields.biome.buffer,
      fields.vegetation.buffer,
      fields.slope.buffer,
      fields.water.buffer,
    ];
    if (water) transfer.push(water.positions.buffer, water.colors.buffer);
    post(result, transfer);
  } catch (err) {
    scope.postMessage({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Surface anything the per-build try/catch misses (module-level throws, rejected
// microtasks) so the worker never goes silent.
scope.addEventListener("error", (e) => console.error("[worldgen worker] error:", e.message));
scope.addEventListener("unhandledrejection", (e) =>
  console.error("[worldgen worker] unhandledrejection:", e.reason),
);

// Serialize builds: each waits for the previous so the shared generator/cache is
// never re-entered concurrently.
let chain: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorldgenInbound>): void => {
  const msg = event.data;
  if (msg.type !== "build") return;
  chain = chain.then(() => build(msg)).catch((e) => console.error("[worldgen worker] chain:", e));
};
