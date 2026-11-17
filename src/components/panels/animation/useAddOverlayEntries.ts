import type { MenuEntry } from '@treDeSpaceUI/widgets';
import {
  PRESET_CALLOUT,
  PRESET_CAPTION,
  PRESET_INFO_IMAGE,
  PRESET_STEP_CARD,
  PRESET_TITLE,
  PRESET_WARNING,
} from '../../../lib/overlay/overlayPresets';
import { calloutsActions } from '../../../state/animation/callouts.actions';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';

/** The built-in designs in menu order, with their hotkeys and how they read
 *  in the menu (the user's own designs follow, without hotkeys). */
const PRESETS: readonly { id: string; label: string; shortcut?: string }[] = [
  { id: PRESET_CALLOUT.id, label: 'Callout on the selection', shortcut: 'animation.addCallout' },
  { id: PRESET_TITLE.id, label: 'Title card', shortcut: 'animation.overlay.title' },
  { id: PRESET_CAPTION.id, label: 'Caption', shortcut: 'animation.overlay.add' },
  { id: PRESET_INFO_IMAGE.id, label: 'Info card (with image)', shortcut: 'animation.overlay.info' },
  { id: PRESET_STEP_CARD.id, label: 'Step card', shortcut: 'animation.overlay.stepCard' },
  { id: PRESET_WARNING.id, label: 'Warning banner', shortcut: 'animation.overlay.warning' },
];

/** "Add an overlay" entries: the built-in designs, then the user's own. */
export function useAddOverlayEntries(): MenuEntry[] {
  const lib = overlayLibraryState.use();
  const entry = (id: string, label: string, shortcut?: string): MenuEntry => ({
    id,
    label,
    tooltip:
      id === PRESET_CALLOUT.id
        ? 'A label hanging from the selected object, from the time slider for 3 s'
        : 'On screen from the time slider for 3 s — drag it into place',
    shortcut,
    onSelect: () => void calloutsActions.addDesign(id),
  });
  const own = lib.components.filter((c) => !PRESETS.some((p) => p.id === c.id));
  return [
    ...PRESETS.filter((p) => lib.components.some((c) => c.id === p.id)).map((p) => entry(p.id, p.label, p.shortcut)),
    own.length > 0 && { separator: true },
    ...own.map((c) => entry(c.id, c.name)),
  ];
}
