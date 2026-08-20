// GPU pass timings (timestamp-query, enabled from the Stats tab): one slot
// per frame-graph pass, resolved to smoothed per-pass milliseconds. The
// renderer marks pass boundaries with writes()/span() while encoding and
// calls resolve() once per frame.

const TS_PASSES = [
  'cull 1',
  'scene 1',
  'hzb',
  'cull 2',
  'scene 2',
  'blend',
  'ao',
  'post',
  'outline',
  'cube',
  'item pick',
] as const;

/** Reject implausible per-pass deltas: some drivers hand back a garbage
 *  begin timestamp for the frame's FIRST pass (seen: ~45 s for cull 1 on an
 *  iGPU), and `end > begin` alone doesn't catch a huge positive delta. */
const TS_MAX_SANE_MS = 1000;

export class GpuTimings {
  /** Device support for 'timestamp-query', set at init. */
  supported = false;
  /** Live user toggle (Stats tab) — the renderer mirrors it before encoding. */
  enabled = false;
  /** smoothed per-pass ms from the last resolved frame, insertion-ordered */
  times: { label: string; ms: number }[] = [];

  private device: GPUDevice | null = null;
  private querySet: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private inFlight = false;
  /** pass slots actually encoded this frame (skipped passes keep stale queries) */
  private encoded: number[] = [];

  attach(device: GPUDevice, supported: boolean) {
    this.device = device;
    this.supported = supported;
  }

  /** Lazily create the query set + buffers; false when timing is off. */
  private ensure(): boolean {
    if (!this.enabled || !this.supported || !this.device) {
      return false;
    }
    if (!this.querySet) {
      const n = TS_PASSES.length * 2;
      this.querySet = this.device.createQuerySet({ type: 'timestamp', count: n });
      this.resolveBuf = this.device.createBuffer({
        label: 'tsResolveBuf',
        size: n * 8,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.readBuf = this.device.createBuffer({
        label: 'tsReadBuf',
        size: n * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    return true;
  }

  /** timestampWrites descriptor for pass slot i, or undefined when timing is off. */
  writes(i: number): GPUComputePassTimestampWrites | undefined {
    if (!this.ensure()) {
      return undefined;
    }
    this.encoded.push(i);
    return { querySet: this.querySet!, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }

  /** Span a slot over a GROUP of passes: 'begin' on the group's first pass,
   *  'end' on its last — the delta covers everything in between (outline's
   *  mask+blur chain, the view cube's msaa+blit pair). The slot is marked
   *  encoded on 'end', so a group that begins must also end within the frame. */
  span(i: number, part: 'begin' | 'end'): GPURenderPassTimestampWrites | undefined {
    if (!this.ensure()) {
      return undefined;
    }
    if (part === 'begin') {
      return { querySet: this.querySet!, beginningOfPassWriteIndex: i * 2 };
    }
    this.encoded.push(i);
    return { querySet: this.querySet!, endOfPassWriteIndex: i * 2 + 1 };
  }

  /** Resolve + read back this frame's timestamps (skips while a read is mapped). */
  resolve(enc: GPUCommandEncoder): (() => void) | null {
    const encoded = new Set(this.encoded);
    this.encoded.length = 0;
    if (!this.enabled || !this.querySet || this.inFlight) {
      return null;
    }
    const n = TS_PASSES.length * 2;
    enc.resolveQuerySet(this.querySet, 0, n, this.resolveBuf!, 0);
    enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, n * 8);
    this.inFlight = true;
    return () => {
      this.readBuf!.mapAsync(GPUMapMode.READ)
        .then(() => {
          const q = new BigUint64Array(this.readBuf!.getMappedRange().slice(0));
          this.readBuf!.unmap();
          this.times = TS_PASSES.map((label, i) => {
            const begin = q[i * 2];
            const end = q[i * 2 + 1];
            // slots not encoded this frame hold stale values → report 0 ms
            const delta = encoded.has(i) && end > begin ? Number(end - begin) / 1e6 : 0;
            const prev = this.times[i]?.ms;
            // implausible sample (garbage begin timestamp) → hold the previous
            // smoothed value rather than poisoning it
            const ms = delta < TS_MAX_SANE_MS ? delta : (prev ?? 0);
            return { label, ms: (prev ?? ms) * 0.8 + ms * 0.2 };
          });
        })
        .catch(() => undefined)
        .finally(() => {
          this.inFlight = false;
        });
    };
  }
}
