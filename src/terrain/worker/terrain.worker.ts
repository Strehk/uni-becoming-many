// ── Becoming Many — Terrain Generation Worker ──────────────────
//
// Builds a chunk's vertex data off the main thread: for each grid vertex it
// samples the active provider's height (world coords), writes chunk-local position
// (lx, h, lz), and computes the surface normal from a height gradient (central
// differences). Pure CPU math — importing ../providers registers the built-in
// providers into this worker's bundle. Results are transferred back.
//
// No three imports here: the worker only produces typed arrays; the main thread
// wraps them in a BufferGeometry (terrain/chunk.ts). The "WebWorker" tsconfig lib
// types `self` as the dedicated worker scope, so postMessage/onmessage need no cast.

/// <reference lib="webworker" />

import { cellToWorldCenter } from "../coords.ts";
import { getTerrainProvider } from "../providers/index.ts";
import type { TerrainBuildResult, WorkerInbound, WorkerOutbound } from "./protocol.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerOutbound, transfer: Transferable[]): void {
  scope.postMessage(message, transfer);
}

scope.onmessage = (event: MessageEvent<WorkerInbound>): void => {
  const msg = event.data;
  if (msg.type !== "build") return;

  try {
    const { providerId, cfg, gridX, gridZ, chunkSize, segments } = msg;
    const provider = getTerrainProvider(providerId);
    // This pool only serves pointwise providers; chunk providers are routed to the
    // worldgen worker instead (see TerrainWorld). Bind the height fn once.
    const height = provider.height;
    if (!height) throw new Error(`Provider "${providerId}" has no pointwise height()`);

    const seg1 = segments + 1;
    const count = seg1 * seg1;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const centerX = cellToWorldCenter(gridX, chunkSize);
    const centerZ = cellToWorldCenter(gridZ, chunkSize);
    const e = chunkSize / segments; // finite-difference step (one cell)

    for (let iz = 0; iz < seg1; iz++) {
      for (let ix = 0; ix < seg1; ix++) {
        const i = iz * seg1 + ix;
        const lx = (ix / segments - 0.5) * chunkSize;
        const lz = (iz / segments - 0.5) * chunkSize;
        const wx = centerX + lx;
        const wz = centerZ + lz;

        const h = height(wx, wz, cfg);
        positions[i * 3] = lx;
        positions[i * 3 + 1] = h;
        positions[i * 3 + 2] = lz;

        // normal = normalize(hL - hR, 2e, hD - hU)
        const hL = height(wx - e, wz, cfg);
        const hR = height(wx + e, wz, cfg);
        const hD = height(wx, wz - e, cfg);
        const hU = height(wx, wz + e, cfg);
        let nx = hL - hR;
        let ny = 2 * e;
        let nz = hD - hU;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
      }
    }

    const result: TerrainBuildResult = {
      type: "built",
      id: msg.id,
      gridX,
      gridZ,
      positions,
      normals,
    };
    post(result, [positions.buffer, normals.buffer]);
  } catch (err) {
    scope.postMessage({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
