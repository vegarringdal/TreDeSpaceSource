// One streamed scan node from its file bytes to GPU words: decode the streams
// and pack them (pointPack.ts). The same function runs in the decode workers
// (pointDecodeWorker.ts) and, where a worker cannot be had, on the main
// thread — so a job and its result are plain data that can cross a thread.
import type { Result } from '../result';
import { packNodeRanged } from './pointPack';
import { boxInView, type PartialNode, type PointRanges, type RangeView } from './pointRanges';
import { decodeNodeSync, type TdppHeader, type TdppNode } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The view a node is packed for ("load only what is in view"): a RangeView
 *  without its clip test, which is a function and cannot cross a thread. */
export type LoadView = Pick<RangeView, 'planes' | 'eye' | 'far'>;

export interface NodeJob {
  readonly node: TdppNode;
  /** The node's payload (the bytes at `node.payloadOffset`). */
  readonly payload: Uint8Array<ArrayBuffer>;
  readonly header: Pick<TdppHeader, 'hasColor' | 'hasIntensity'>;
  /** Keep only the points this setup measured (null = all). */
  readonly onlySetup: number | null;
  /** Upload only the ranges in this view (null = the whole node). */
  readonly loadView: LoadView | null;
  /** The file's grid, metres. */
  readonly grid: number;
}

export interface NodeJobDone {
  readonly words: Uint32Array<ArrayBuffer>;
  readonly ranges: PointRanges | null;
  readonly partial: PartialNode | null;
  readonly decodeMs: number;
  readonly packMs: number;
}

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Decode and pack one node. The stream decoder must be ready
 *  (tdppFormat's `decoderReady`). */
export function runNodeJob(job: NodeJob): Result<NodeJobDone> {
  const decodeAt = performance.now();
  const dec = decodeNodeSync(job.node, job.payload);
  const packAt = performance.now();
  if (!dec.data) {
    return { error: dec.error ?? { err: null, msg: 'node decode failed' } };
  }

  const view = job.loadView;
  const keep = view ? (boxes: Float32Array, o: number) => boxInView(boxes, o, view) : undefined;
  const packed = packNodeRanged(dec.data, job.node, job.header, job.onlySetup, undefined, keep, job.grid);
  return {
    data: {
      words: packed.words,
      ranges: packed.ranges,
      partial: packed.partial,
      decodeMs: packAt - decodeAt,
      packMs: performance.now() - packAt,
    },
  };
}

/** The buffers of a result that are handed over, not copied, when it crosses
 *  a thread. (A partial node's boxes are the range layout's own array.) */
export function transferables(done: NodeJobDone): ArrayBuffer[] {
  const out = new Set<ArrayBufferLike>([done.words.buffer]);
  if (done.ranges) {
    out.add(done.ranges.spans.buffer);
    out.add(done.ranges.boxes.buffer);
  }
  if (done.partial) {
    out.add(done.partial.boxes.buffer);
    out.add(done.partial.kept.buffer);
  }
  return [...out].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}
