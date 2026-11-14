import { IconPhoto } from '@tabler/icons-react';
import { cn } from '@treDeSpaceUI/lib';
import { scansActions } from '../../../state/scans/scans.actions';
import type { ScanSetupView } from '../../../state/scans/scans.state';

interface ScanSetupRowProps {
  setup: ScanSetupView;
  /** Highlighted in the list (and its sphere in the scene). */
  isSelected: boolean;
  /** The camera is inside this setup. */
  isActive: boolean;
}

/** One scanner setup of a scan: click selects, double-click enters. */
export function ScanSetupRow({ setup, isSelected, isActive }: ScanSetupRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-tooltip={setup.hasPanorama ? 'Double-click to enter' : 'No panorama — entering only moves the camera'}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs hover:bg-slate-700/50',
        isSelected && 'bg-sky-900/60',
        isActive && 'font-semibold text-amber-300',
      )}
      onClick={() => scansActions.select(setup.key)}
      onDoubleClick={() => void scansActions.enter(setup.key)}
    >
      <IconPhoto size={12} className={cn('shrink-0', setup.hasPanorama ? 'text-sky-400' : 'opacity-20')} />
      <span className="truncate">{setup.label}</span>
      {isActive && <span className="ml-auto shrink-0 text-[10px] uppercase">inside</span>}
    </button>
  );
}
