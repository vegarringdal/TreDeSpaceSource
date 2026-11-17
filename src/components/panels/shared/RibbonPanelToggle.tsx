import { usePanelContext } from '@treDeSpaceUI/dockable';
import { RibbonButton } from '@treDeSpaceUI/widgets';
import { type ReactNode, useSyncExternalStore } from 'react';

/** A ribbon button for a list panel that belongs to the ribbon (Measurement
 *  List, Clip Shape List, Transform Objects): lit while that panel is open,
 *  and a click shows / hides it. `onClick` is the ribbon's own action, so the
 *  button and its hotkey do the same thing. */
export function RibbonPanelToggle({
  panel,
  icon,
  label,
  tooltip,
  shortcut,
  onClick,
}: {
  /** dock panel id (appPanels.ts) whose open state lights the button */
  panel: string;
  icon: ReactNode;
  label: string;
  tooltip?: string;
  /** hotkey id of the action `onClick` runs */
  shortcut?: string;
  onClick: () => void;
}) {
  const { manager } = usePanelContext();
  const isOpen = useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.isOpen(panel),
  );

  return (
    <RibbonButton icon={icon} label={label} selected={isOpen} tooltip={tooltip} shortcut={shortcut} onClick={onClick} />
  );
}
