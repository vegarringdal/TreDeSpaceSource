import { createStore } from '@treDeSpaceUI/lib/createStore';

/** What the scan point streamer shows right now (Scans panel readout). Its
 *  own store so the per-load updates don't re-run the viewport's options. */
export interface PointStatsState {
  /** Points drawn this frame: the drawn nodes without the ranges of them
   *  that lie outside the view (lib/tdpp/pointRanges.ts). */
  readonly drawn: number;
  /** What the drawn nodes were charged to the point budget: an estimate of
   *  their points in view / in range / not clipped away. Equal to `drawn`
   *  when nothing is charged by share. */
  readonly inView: number;
  /** Nodes drawn / resident on the GPU / being fetched. */
  readonly nodes: number;
  /** Draw calls: one per node drawn whole, one per run of a cut node. */
  readonly draws: number;
  readonly resident: number;
  readonly loading: number;
  /** Points held on the GPU (drawn + cached), 12 bytes each. */
  readonly residentPoints: number;
}

export const pointStatsState = createStore<PointStatsState>({
  drawn: 0,
  inView: 0,
  nodes: 0,
  draws: 0,
  resident: 0,
  loading: 0,
  residentPoints: 0,
});
