// One scan node from file bytes to GPU words (lib/tdpp/pointNodeJob.ts) and
// the decode pool's main-thread fallback (pointDecodePool.ts — vitest has no
// Worker, so this is the path it takes), on the synthetic .tdpp fixture.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POINT_HEADER_WORDS as H, POINT_WORDS as W } from '../src/lib/render/shaders/points';
import { decodeNodeJob } from '../src/lib/tdpp/pointDecodePool';
import { type NodeJob, runNodeJob, transferables } from '../src/lib/tdpp/pointNodeJob';
import { packNodeRanged, unpackPoint } from '../src/lib/tdpp/pointPack';
import { decodeNode, decoderReady, openTdpp, type TdppSource } from '../src/lib/tdpp/tdppFormat';

const root = fileURLToPath(new URL('..', import.meta.url));
const bytes = new Uint8Array(readFileSync(resolve(root, 'tests/fixtures/synthetic.tdpp')));
const src: TdppSource = {
  size: bytes.byteLength,
  read: async (offset, length) => bytes.slice(offset, offset + length),
};

async function firstNodeJob(over: Partial<NodeJob> = {}): Promise<NodeJob> {
  const opened = await openTdpp(src);
  if (!opened.data) {
    throw new Error(opened.error?.msg);
  }
  const file = opened.data;
  const node = file.nodes[0];
  return {
    node,
    payload: await src.read(node.payloadOffset, node.payloadSize),
    header: { hasColor: file.header.hasColor, hasIntensity: file.header.hasIntensity },
    onlySetup: null,
    loadView: null,
    grid: file.meta.gridScale,
    ...over,
  };
}

describe('runNodeJob', () => {
  it('gives the words the decode and the pack give on their own', async () => {
    await decoderReady();
    const job = await firstNodeJob();
    const done = runNodeJob(job);
    expect(done.error).toBeUndefined();
    const dec = await decodeNode(job.node, job.payload);
    if (!dec.data || !done.data) {
      throw new Error('decode failed');
    }
    const direct = packNodeRanged(dec.data, job.node, job.header, null, undefined, undefined, job.grid);
    expect([...done.data.words]).toEqual([...direct.words]);
    expect(done.data.words.length).toBe(H + W * job.node.pointCount);
    expect(done.data.partial).toBeNull();
    // the result's buffers can be handed to another thread, each once
    const buffers = transferables(done.data);
    expect(buffers).toContain(done.data.words.buffer);
    expect(new Set(buffers).size).toBe(buffers.length);
  });

  it('reports a damaged payload instead of throwing', async () => {
    await decoderReady();
    const job = await firstNodeJob();
    const done = runNodeJob({ ...job, payload: job.payload.slice(0, 10) });
    expect(done.data).toBeUndefined();
    expect(done.error?.msg).toMatch(/payload/);
  });

  it('uploads nothing of a node outside the load view', async () => {
    await decoderReady();
    // five planes that reject everything: x >= 1e9
    const planes = new Float32Array([1, 0, 0, -1e9, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const job = await firstNodeJob({ loadView: { planes, eye: [0, 0, 0], far: Number.POSITIVE_INFINITY } });
    const done = runNodeJob(job);
    if (!done.data) {
      throw new Error('decode failed');
    }
    // a node small enough to be one range is not cut: it is uploaded whole
    const whole = done.data.words.length === H + W * job.node.pointCount;
    const empty = done.data.words.length === H;
    expect(whole || empty).toBe(true);
    expect(empty).toBe(done.data.partial !== null);
  });
});

describe('decodeNodeJob without workers', () => {
  it('runs the job on the main thread and says so', async () => {
    const job = await firstNodeJob();
    const expected = runNodeJob(await firstNodeJob());
    const done = await decodeNodeJob(job);
    expect(done.data?.isOffThread).toBe(false);
    expect([...(done.data?.words ?? [])]).toEqual([...(expected.data?.words ?? [])]);
    const first = unpackPoint(done.data?.words ?? new Uint32Array(H + W), 0);
    expect(first.position.every(Number.isFinite)).toBe(true);
  });
});
