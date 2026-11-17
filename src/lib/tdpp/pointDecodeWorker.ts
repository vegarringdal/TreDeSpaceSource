// Decode worker of the scan point streamer: turns a node's file bytes into
// GPU words off the main thread (pointNodeJob.ts). Plain messages — a request
// carries an id, the answer carries it back — driven by pointDecodePool.ts.
import { type NodeJob, runNodeJob, transferables } from './pointNodeJob';
import { decoderReady } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface DecodeRequest {
  readonly id: number;
  readonly job: NodeJob;
}

export type DecodeResponse =
  | { readonly id: number; readonly done: NonNullable<ReturnType<typeof runNodeJob>['data']> }
  | { readonly id: number; readonly error: string };

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

const ready = decoderReady();

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, job } = e.data;
  let response: DecodeResponse;
  try {
    await ready;
    const result = runNodeJob(job);
    response = result.data ? { id, done: result.data } : { id, error: result.error?.msg ?? 'node decode failed' };
  } catch (err) {
    response = { id, error: `node decode failed: ${err}` };
  }
  self.postMessage(response, { transfer: 'done' in response ? transferables(response.done) : [] });
};
