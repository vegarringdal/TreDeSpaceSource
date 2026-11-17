import { IconRestore } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { type ScanSettingKey, sameSettings } from '../../../state/scans/scanSettings';
import { SCAN_SETTING_DEFAULTS } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ScanSettingsResetProps {
  /** What is reset, as the tooltip names it ("the photo settings"). */
  label: string;
  /** The settings of the section. */
  keys: readonly ScanSettingKey[];
  /** Hotkey id of the reset. */
  shortcut: string;
  onReset: () => void;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ICON_SIZE = 14;

/** A Scans section's reset, in its header like the Settings sections have:
 *  greyed out while the section already equals its defaults. */
export function ScanSettingsReset({ label, keys, shortcut, onReset }: ScanSettingsResetProps) {
  const isDirty = !sameSettings(scansState.use(), SCAN_SETTING_DEFAULTS, keys);

  return (
    <Button
      iconOnly
      size="xs"
      icon={<IconRestore size={ICON_SIZE} />}
      disabled={!isDirty}
      tooltip={
        isDirty ? `Reset ${label} to defaults` : `${label[0].toUpperCase()}${label.slice(1)} are at their defaults`
      }
      shortcut={shortcut}
      onClick={onReset}
    />
  );
}
