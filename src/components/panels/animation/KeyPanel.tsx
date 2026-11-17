// The Key panel (DESIGN.md › Animation › Authoring): what the picked key
// holds, or — on an object row — the next key at the time slider, the
// camera / section / colour-rules row, a step, a callout, or the scene.
import { IconMovie } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, EmptyState } from '@treDeSpaceUI/widgets';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { KeyTargetView } from './KeyTargetView';
import { ProblemsSection } from './ProblemsSection';
import { useKeyTarget } from './useKeyTarget';

/** The Key panel. */
export function KeyPanel() {
  useMinSize(260, 200);
  const target = useKeyTarget();

  if (target.kind === 'off') {
    return (
      <PanelBody className="flex flex-col">
        <EmptyState layout="center" icon={<IconMovie size={28} />}>
          <div className="flex flex-col items-center gap-2">
            <span>Turn on Animate to make objects and keys — the scene is restored when you leave.</span>
            <Button
              variant="primary"
              icon={<IconMovie />}
              tooltip="Enter animation authoring"
              shortcut="animation.toggleMode"
              onClick={() => void animationUiActions.enterAuthoring()}
            >
              Animate
            </Button>
          </div>
        </EmptyState>
      </PanelBody>
    );
  }

  return (
    <PanelBody className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <KeyTargetView target={target} />
        <ProblemsSection scene={target.scene} />
      </div>
    </PanelBody>
  );
}
