// Open laser-scan files (.tdpp): the live handles behind scansState — the
// panorama actions (scans.actions.ts) and the point streamer (scanPoints.ts)
// both read them; only scansActions.openAsset / closeAsset change the map.
import type { TdppFile, TdppSource } from '../../lib/tdpp/tdppFormat';

export interface OpenScan {
  readonly name: string;
  readonly src: TdppSource;
  /** The file as stored. */
  readonly base: TdppFile;
  /** The file as placed (scanPlacement.ts placeTdpp): `base` in the chosen
   *  coordinate system, moved by the scan's offset. Replaced when either
   *  changes — the object itself stays, so the streamer keeps the points it
   *  has loaded (they are relative to the origin, along the stored axes). */
  file: TdppFile;
}

/** assetId → open scan. */
export const openScans = new Map<string, OpenScan>();
