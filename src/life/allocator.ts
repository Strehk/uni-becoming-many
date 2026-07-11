// ── Becoming Many — Instance Slot Allocator ────────────────────
//
// Every species owns one global InstancedMesh per part, carved into `slotCount`
// equal blocks of `perChunkCap` instances. A streamed chunk claims one slot; when it
// streams out the slot is released. Equal-size blocks mean zero fragmentation by
// construction, so there is no compaction pass and a chunk's instances never move.
//
// The allocator always hands out the LOWEST free slot, so occupied blocks stay
// packed toward index 0 and a chunk streaming back in tends to reuse a warm slot.
// The instanced draw always covers full capacity regardless (see instancing.ts —
// three picks its instancing strategy from `mesh.count`, so that count is pinned).

export class SlotAllocator {
  private readonly occupied: Uint8Array;
  private live = 0;

  constructor(readonly slotCount: number) {
    this.occupied = new Uint8Array(slotCount);
  }

  /** Lowest free slot, or `null` when every block is taken. */
  claim(): number | null {
    for (let i = 0; i < this.slotCount; i++) {
      if (this.occupied[i] === 0) {
        this.occupied[i] = 1;
        this.live++;
        return i;
      }
    }
    return null;
  }

  release(slot: number): void {
    if (this.occupied[slot] === 1) {
      this.occupied[slot] = 0;
      this.live--;
    }
  }

  releaseAll(): void {
    this.occupied.fill(0);
    this.live = 0;
  }

  get liveCount(): number {
    return this.live;
  }
}
