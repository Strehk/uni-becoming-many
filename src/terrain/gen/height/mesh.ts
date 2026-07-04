// ── Becoming Many — Chunk Vertex Array Builder ─────────────────
//
// Builds a chunk's per-vertex arrays from the detail generator. Emits plain typed
// arrays — NO three import — so this runs inside the worldgen worker; the main
// thread wraps them in a BufferGeometry with the shared grid index.
//
// Geometry is chunk-LOCAL, centred on the chunk (x,z ∈ [-size/2, size/2]); world
// XZ is reconstructed from the chunk origin so the detail noise stays seam-free.
// Normals come from a one-vertex apron of real-neighbour heights, so edge normals
// match neighbours. PURE CPU — no three, no DOM.

import type { ChunkVertexData } from "../../provider.ts";
import type { GenParams } from "../mapTypes.ts";
import type { TerrainDetailGenerator } from "./TerrainDetailGenerator.ts";
import { computeGridNormals } from "./TerrainNormalBuilder.ts";
import type { TerrainSampler } from "./TerrainSampler.ts";
import { writeVertexColor } from "./vertexColor.ts";

/**
 * @param sampler   reads the chunk's Stage-1 maps (seamless bordered height etc.)
 * @param detail    adds local relief; `worldY` is a pure function of world (x,y)
 * @param params    generation params (snow height/softness for vertex colour)
 * @param segments  grid segments per chunk edge (verts per edge = segments+1)
 */
export function buildChunkArrays(
  sampler: TerrainSampler,
  detail: TerrainDetailGenerator,
  params: GenParams,
  segments: number,
): ChunkVertexData {
  const size = sampler.size;
  const res = Math.max(8, segments | 0);
  const vpe = res + 1; // verts per edge
  const step = size / res;
  const half = size / 2;
  const ox = sampler.originX;
  const oy = sampler.originY;
  const seed = params.seed >>> 0;

  // Extended height grid (1-vertex apron) for seam-free normals.
  const ew = res + 3;
  const extY = new Float32Array(ew * ew);
  for (let ej = 0; ej < ew; ej++) {
    const wy = oy + (ej - 1) * step;
    for (let ei = 0; ei < ew; ei++) {
      const wx = ox + (ei - 1) * step;
      extY[ej * ew + ei] = detail.worldY(wx, wy, sampler);
    }
  }

  const positions = new Float32Array(vpe * vpe * 3);
  const heightGrid = new Float32Array(vpe * vpe);
  const biome = new Uint8Array(vpe * vpe);
  const colors = new Float32Array(vpe * vpe * 3);
  for (let j = 0; j <= res; j++) {
    const localZ = -half + j * step;
    const wy = oy + j * step;
    const v = j / res;
    for (let i = 0; i <= res; i++) {
      const wx = ox + i * step;
      const u = i / res;
      const vi = j * vpe + i;
      // Full evaluation for position Y + the masks the colour baker wants (the
      // apron extY above drives normals; here we sample interior verts directly).
      const point = detail.evaluate(wx, wy, sampler);
      positions[vi * 3] = -half + i * step;
      positions[vi * 3 + 1] = point.y;
      positions[vi * 3 + 2] = localZ;
      heightGrid[vi] = point.y;
      const b = sampler.sampleBiome(u, v);
      biome[vi] = b;
      writeVertexColor(colors, vi * 3, point, b, wx, wy, params, seed);
    }
  }

  const normals = computeGridNormals(extY, res, step);
  return { positions, normals, biome, colors, heightGrid };
}
