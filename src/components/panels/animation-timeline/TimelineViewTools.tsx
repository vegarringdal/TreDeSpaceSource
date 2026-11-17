import { IconMagnet, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { Button, zoomTimelineView } from '@treDeSpaceUI/widgets';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';

const ZOOM_STEP = 1.25;

/** Snap · zoom out · zoom in. */
export function TimelineViewTools() {
  const ui = animationUiState.use();
  const zoom = (f: number) => animationUiActions.set({ view: zoomTimelineView(ui.view, f, 0) });

  return (
    <>
      <Button
        iconOnly
        size="sm"
        icon={<IconMagnet />}
        active={ui.snap}
        tooltip="Snap to keys, step edges and the grid"
        shortcut="animation.toggleSnap"
        onClick={animationUiActions.toggleSnap}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconZoomOut />}
        tooltip="Zoom out (Ctrl+wheel)"
        shortcut="animation.zoomOut"
        onClick={() => zoom(1 / ZOOM_STEP)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconZoomIn />}
        tooltip="Zoom in (Ctrl+wheel)"
        shortcut="animation.zoomIn"
        onClick={() => zoom(ZOOM_STEP)}
      />
    </>
  );
}
