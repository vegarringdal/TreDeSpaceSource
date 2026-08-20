import { Button, NumberInput, TextInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';

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

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <Button
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={visibleAssetIds.length === 0}
          onClick={() => onSelect(new Set(visibleAssetIds))}
          tooltip="Select every visible asset in every store (respects the search filter)"
        >
          Select all
        </Button>
        <Button
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={selCount === 0}
          onClick={() => onSelect(new Set())}
          tooltip="Clear the selection"
        >
          Deselect all
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Selected: {visibleSelectedCount}</span>
        <label
          className="flex flex-1 cursor-pointer items-center gap-2 text-slate-300 text-xs"
          data-tooltip="Don't move the camera when loading more models (default fits the loaded selection)"
        >
          <input type="checkbox" checked={keepCamera} onChange={(e) => act.setKeepCamera(e.target.checked)} />
          Keep camera
        </label>
        <label className="flex flex-1 shrink-0 items-center gap-1 text-slate-400 text-xs">
          Pool
          <div className="w-20">
            <NumberInput value={loadPool} min={1} max={10} step={1} onChange={act.setLoadPool} />
          </div>
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search name / folder… (a & b, a | b, parens)"
          />
        </div>
        <Button
          active={exact}
          onClick={onToggleExact}
          tooltip="Equals mode — whole-string match, * wildcards allowed (off = contains)"
        >
          =*
        </Button>
      </div>
    </>
  );
}
