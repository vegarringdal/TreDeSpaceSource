import { NumberInput, Select } from '@treDeSpaceUI/widgets';
import { SOURCE_FRAME } from '../../../lib/tdpp/scanPlacement';
import { assetsActions } from '../../../state/assets/assets.actions';
import { type ScanAssetView, scansState } from '../../../state/scans/scans.state';

const AXES = ['x', 'y', 'z'] as const;
const OFFSET_RANGE_M = 1_000_000;
const SOURCE_FRAME_LABEL = 'Scanner project frame';
/** Label column shared by the two rows, px — wide enough for "Offset m" unclipped. */
const LABEL_WIDTH = 58;

/** Where a scan sits: the coordinate system it is shown in (when its source
 *  has any) and an offset on top — one row of three boxes, each with its
 *  axis letter in front, that move the points, the setup spheres and the
 *  photos together. The row's own caption shows only where the panel is wide
 *  enough: the letters must never be what gets cut off. Both are saved with
 *  the asset. */
export function ScanOffsetRow({ asset }: { asset: ScanAssetView }) {
  const { offsetStep } = scansState.use();

  const handleOffset = (axis: number, value: number) => {
    const next: [number, number, number] = [asset.offset[0], asset.offset[1], asset.offset[2]];
    next[axis] = value;
    void assetsActions.setScanOffset(asset.assetId, next);
  };

  return (
    <div className="flex flex-col gap-1">
      {asset.systems.length > 1 && (
        <Select
          label="Coords"
          labelPosition="left"
          labelWidth={LABEL_WIDTH}
          value={asset.system}
          options={asset.systems.map((n) => ({ value: n, label: n === SOURCE_FRAME ? SOURCE_FRAME_LABEL : n }))}
          onChange={(v) => void assetsActions.setScanCoordSystem(asset.assetId, v ?? SOURCE_FRAME)}
          shortcut="scans.coordSystem.next"
          tooltip="The coordinate system this scan is shown in: one of those stored in the scan (for example the one from survey control), or the scanner project’s own frame. Switching is instant and remembered for the scan"
        />
      )}
      <div className="@container">
        <div className="flex items-center gap-1 text-slate-400 text-xs">
          <span
            className="@[340px]:block hidden shrink-0 truncate"
            style={{ width: LABEL_WIDTH }}
            data-tooltip="Offset in metres: moves this scan to line it up with a model"
          >
            Offset m
          </span>
          {AXES.map((axis, k) => (
            <div key={axis} className="flex min-w-0 flex-1 items-center gap-1">
              <span className="shrink-0">{axis.toUpperCase()}</span>
              <NumberInput
                className="min-w-0 flex-1"
                value={asset.offset[k]}
                min={-OFFSET_RANGE_M}
                max={OFFSET_RANGE_M}
                step={offsetStep}
                precision={3}
                onChange={(v) => handleOffset(k, v)}
                tooltip={`Offset along ${axis.toUpperCase()}, metres: moves this scan (points, setups, photos) to line it up with a model. Remembered for this scan`}
                decShortcut={`scans.offset.${axis}.dec`}
                incShortcut={`scans.offset.${axis}.inc`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
