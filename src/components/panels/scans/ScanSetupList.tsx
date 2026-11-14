import { scansState } from '../../../state/scans/scans.state';
import { ScanFilePanel } from './ScanFilePanel';
import { ScanListToolbar } from './ScanListToolbar';

/** The loaded scans: a toolbar (offset step, open / fold all) pinned above a
 *  list that scrolls by itself, one folding section per file (see
 *  ScanFilePanel). */
export function ScanSetupList() {
  const { assets, setups, selected, active, hidden, folded } = scansState.use();

  return (
    <>
      <ScanListToolbar />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {assets.map((a) => (
          <ScanFilePanel
            key={a.assetId}
            asset={a}
            setups={setups.filter((s) => s.assetId === a.assetId)}
            isShown={!hidden.includes(a.assetId)}
            isFolded={folded.includes(a.assetId)}
            selected={selected}
            active={active}
          />
        ))}
      </div>
    </>
  );
}
