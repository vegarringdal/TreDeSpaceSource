import { createStore } from '@treDeSpaceUI/lib/createStore';

/** What the scan point streamer shows right now (Scans panel readout). Its
 *  own store so the per-load updates don't re-run the viewport's options. */
export interface PointStatsState {
  /** Points drawn this frame: every point of the drawn nodes, the parts
   *  outside the view included (a node is drawn whole). */
  readonly drawn: number;
  /** What the drawn nodes were charged to the point budget: an estimate of
   *  their points in view / in range / not clipped away. Equal to `drawn`
   *  when nothing is charged by share. */
  readonly inView: number;
  /** Nodes drawn / resident on the GPU / being fetched. */
  readonly nodes: number;
  readonly resident: number;
  readonly loading: number;
  /** Points held on the GPU (drawn + cached), 16 bytes each. */
  readonly residentPoints: number;
}

export const pointStatsState = createStore<PointStatsState>({
  drawn: 0,
  inView: 0,
  nodes: 0,
  resident: 0,
  loading: 0,
  residentPoints: 0,
});
