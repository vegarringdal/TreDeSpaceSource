import { IconKey, IconLayersSubtract, IconLayoutBoardSplit, IconPalette, IconTimeline } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type ReactNode, useSyncExternalStore } from 'react';
import type { AnimationPanelId } from '../animation/animationPanels';
import { panelToggleHotkeyId } from '../ribbon-panels/panelToggle';

/** The animation panels, in ribbon order (three rows a column). */
const PANELS: readonly { id: AnimationPanelId; label: string; icon: ReactNode; tip: string }[] = [
  {
    id: 'animationTimeline',
    label: 'Timeline',
    icon: <IconTimeline />,
    tip: 'Objects, keys, steps and overlays on a time axis — and the play and export controls',
  },
  {
    id: 'animation',
    label: 'Key',
    icon: <IconKey />,
    tip: 'What the picked key holds, or the next key at the time slider',
  },
  {
    id: 'multiColor',
    label: 'Set Color',
    icon: <IconPalette />,
    tip: 'The Set Color panel (its Save / Load and big rule list)',
  },
  {
    id: 'overlayEditor',
    label: 'Overlay Editor',
    icon: <IconLayersSubtract />,
    tip: 'Design the 2D overlays (title and info cards, step cards, callouts)',
  },
  {
    id: 'overlayPreview',
    label: 'Overlay Preview',
    icon: <IconLayoutBoardSplit />,
    tip: 'Live preview of the design open in the Overlay Editor',
  },
];

/** Panels: one toggle per animation panel, selected while it is open — the
 *  Panel ribbon's toggles (click shows / hides, drag places it). */
export function AnimPanelsGroups() {
  const { manager } = usePanelContext();
  useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.version,
  );

  return (
    <RibbonSection title="Panels">
      {PANELS.map((p) => (
        <RibbonButton
          key={p.id}
          size="mini"
          className="!cursor-grab active:!cursor-grabbing touch-none"
          icon={p.icon}
          label={p.label}
          selected={manager.isOpen(p.id)}
          tooltip={`${p.tip} · click to show / hide, drag to place it`}
          shortcut={panelToggleHotkeyId(p.id)}
          onPointerDown={(e) => manager.dragPanelFrom(e.nativeEvent, p.id)}
          onClick={() => {
            if (!manager.consumeDragClick()) {
              manager.togglePanel(p.id);
            }
          }}
        />
      ))}
    </RibbonSection>
  );
}
