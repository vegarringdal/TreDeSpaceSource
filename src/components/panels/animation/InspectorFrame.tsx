import { IconX } from '@tabler/icons-react';
import { Button, PanelHeader } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { animationUiActions } from '../../../state/animation/animationUi.actions';

/** Shared Key panel chrome: "Key — Pump · 2.0 s" + its actions + close
 *  (back to the scene settings). */
export function InspectorFrame({
  kind,
  name,
  actions,
  children,
}: {
  kind: string;
  name: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const handleClose = () => {
    animationUiActions.pick({ kind: 'none' });
    animationUiActions.setCurrent(null);
  };

  return (
    <div className="flex flex-col">
      <PanelHeader
        variant="band"
        title={name ? `${kind} — ${name}` : kind}
        actions={
          <>
            {actions}
            <Button
              shortcut="animation.inspector.close"
              iconOnly
              size="sm"
              variant="ghost"
              icon={<IconX />}
              tooltip="Back to the scene settings"
              onClick={handleClose}
            />
          </>
        }
      />
      <div className="flex flex-col gap-1.5 p-2">{children}</div>
    </div>
  );
}
