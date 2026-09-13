import { Button, Checkbox, NumberInput, SegmentedControl, TextInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { workerPoolCap } from '../../../state/assets/workerPoolCap';

/** The two name-match modes of the asset search — the same pair the Hierarchy
 *  search offers, so one concept has one look. */
const MATCH_MODES = [
  { value: 'contains', label: '*', tooltip: 'Contains — any part of the name matches' },
  { value: 'exact', label: '=', tooltip: 'Equals — whole-string match, * wildcards allowed' },
] as const;

type StoreSelectionRowsProps = Readonly<{
  visibleAssetIds: string[];
  visibleSelectedCount: number;
  selCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  exact: boolean;
  onToggleExact: () => void;
  onSelect: (next: Set<string>) => void;
}>;

/** Select all/none, the load options row (keep camera, pool) and the search
 *  filter for one store's library. */
export function StoreSelectionRows({
  visibleAssetIds,
  visibleSelectedCount,
  selCount,
  query,
  onQueryChange,
  exact,
  onToggleExact,
  onSelect,
}: StoreSelectionRowsProps) {
  const { loadPool, keepCamera } = assetsState.use();
  const poolCap = workerPoolCap();

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <Button
          wrap
          grow
          disabled={visibleAssetIds.length === 0}
          onClick={() => onSelect(new Set(visibleAssetIds))}
          tooltip="Select every visible asset in every store (respects the search filter)"
        >
          Select all
        </Button>
        <Button wrap grow disabled={selCount === 0} onClick={() => onSelect(new Set())} tooltip="Clear the selection">
          Deselect all
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Selected: {visibleSelectedCount}</span>
        <Checkbox
          className="flex-1"
          label="Keep camera"
          checked={keepCamera}
          onChange={act.setKeepCamera}
          tooltip="Don't move the camera when loading more models (default fits the loaded selection)"
        />
        <NumberInput
          className="flex-1"
          label="Pool"
          labelPosition="left"
          labelWidth={32}
          value={loadPool}
          min={1}
          max={poolCap}
          step={1}
          tooltip={`Models loaded at once (max ${poolCap} on this machine). Each keeps its whole file in memory until it is on the GPU.`}
          onChange={act.setLoadPool}
          decShortcut="assets.loadPool.dec"
          incShortcut="assets.loadPool.inc"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            type="search"
            value={query}
            onChange={onQueryChange}
            placeholder="Search name / folder… (a & b, a | b, parens)"
          />
        </div>
        <SegmentedControl value={exact ? 'exact' : 'contains'} options={MATCH_MODES} onChange={onToggleExact} />
      </div>
    </>
  );
}
