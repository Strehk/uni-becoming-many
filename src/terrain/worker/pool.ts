// ── Becoming Many — Terrain Worker Pool ────────────────────────
//
// A lean round-robin pool of terrain workers (provider-agnostic). build() returns
// a promise for the chunk's vertex arrays; the ChunkScheduler handles cancellation
// of results that arrive after the player has moved (it disposes the chunk on
// resolve), so the pool itself stays minimal.

import type { TerrainConfig } from "../provider.ts";
import type { TerrainBuildResult, WorkerInbound, WorkerOutbound } from "./protocol.ts";

interface Pending {
  resolve: (r: TerrainBuildResult) => void;
  reject: (e: Error) => void;
}

function defaultWorkerCount(): number {
  const hwc = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(1, Math.min(4, hwc - 1));
}

// Framework-agnostic module-worker construction (see AGENT.md / terrain plan §4).
function createWorker(): Worker {
  return new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
}

export class TerrainWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private nextWorker = 0;
  private disposed = false;

  constructor(workerCount = defaultWorkerCount()) {
    for (let i = 0; i < workerCount; i++) {
      const w = createWorker();
      w.onmessage = (e: MessageEvent<WorkerOutbound>) => this.handle(e.data);
      w.onerror = (e: ErrorEvent) => this.handleError(e);
      this.workers.push(w);
    }
  }

  build(
    providerId: string,
    cfg: TerrainConfig,
    gridX: number,
    gridZ: number,
    chunkSize: number,
    segments: number,
  ): Promise<TerrainBuildResult> {
    if (this.disposed) return Promise.reject(new Error("TerrainWorkerPool: disposed"));
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker];
    if (!worker) return Promise.reject(new Error("TerrainWorkerPool: no workers"));
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    return new Promise<TerrainBuildResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: WorkerInbound = {
        type: "build",
        id,
        providerId,
        cfg,
        gridX,
        gridZ,
        chunkSize,
        segments,
      };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.pending.values()) p.reject(new Error("TerrainWorkerPool: disposed"));
    this.pending.clear();
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }

  private handle(msg: WorkerOutbound): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === "error") p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  private handleError(e: ErrorEvent): void {
    // A worker crashed; fail everything in flight (rare). The scheduler re-requests
    // missing chunks on the next update.
    const err = new Error(`TerrainWorker error: ${e.message}`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
