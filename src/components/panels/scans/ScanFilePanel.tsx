import { IconEye, IconEyeOff, IconX } from '@tabler/icons-react';
import { cn } from '@treDeSpaceUI/lib';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { scansActions } from '../../../state/scans/scans.actions';
import type { ScanAssetView, ScanSetupView } from '../../../state/scans/scans.state';
import { ScanOffsetRow } from './ScanOffsetRow';
import { ScanSetupRow } from './ScanSetupRow';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ScanFilePanelProps {
  asset: ScanAssetView;
  /** This scan's setups. */
  setups: readonly ScanSetupView[];
  /** Switched on: its points and setup spheres are drawn. */
  isShown: boolean;
  /** Folded away: only the header shows. */
  isFolded: boolean;
  selected: string | null;
  active: string | null;
}

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const fmtPoints = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString());

/**
 * One loaded scan file as a section of its own that folds away: the name, its
 * size on the right and an on / off and a remove button in the header; where
 * the scan sits and its setups inside. Switched off, the setups are not
 * listed — their spheres are not in the scene to enter.
 */
export function ScanFilePanel({ asset, setups, isShown, isFolded, selected, active }: ScanFilePanelProps) {
  const setupNote = `${asset.setupCount} setup${asset.setupCount === 1 ? '' : 's'}`;

  return (
    <Collapsible
      open={!isFolded}
      onToggle={() => scansActions.toggleScanFolded(asset.assetId)}
      title={<span className={cn('min-w-0 truncate', !isShown && 'text-slate-500')}>{asset.name}</span>}
      aside={
        <span className="whitespace-nowrap" data-tooltip={`${asset.pointCount.toLocaleString()} points, ${setupNote}`}>
          {fmtPoints(asset.pointCount)} · {setupNote}
        </span>
      }
      actions={
        <>
          <Button
            iconOnly
            size="sm"
            active={isShown}
            icon={isShown ? <IconEye /> : <IconEyeOff />}
            onClick={() => scansActions.toggleScan(asset.assetId)}
            shortcut="scans.scan.toggle"
            tooltip={
              isShown
                ? 'On — click to hide this scan’s points and setup spheres (it stays loaded)'
                : 'Off — click to show this scan’s points and setup spheres'
            }
          />
          <Button
            iconOnly
            size="sm"
            icon={<IconX />}
            onClick={() => scansActions.closeAsset(asset.assetId)}
            shortcut="scans.scan.remove"
            tooltip="Remove this scan from the scene (the asset stays in the library)"
          />
        </>
      }
      bodyClassName="gap-1.5 p-1.5"
    >
      <ScanOffsetRow asset={asset} />
      {isShown ? (
        <div className="flex flex-col" role="listbox" aria-label={`Setups of ${asset.name}`}>
          {setups.map((s) => (
            <ScanSetupRow key={s.key} setup={s} isSelected={s.key === selected} isActive={s.key === active} />
          ))}
        </div>
      ) : (
        <span className="px-1 text-slate-500 text-xs">Switched off — its setups are hidden.</span>
      )}
    </Collapsible>
  );
}
