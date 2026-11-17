// Overlay Preview panel: the Overlay Editor's working copy, live, with editable
// sample content. Its own panel so it can sit beside the editor at any size —
// inside the editor, a narrow column made preview and inspector share one tab.
import { IconLayoutBoardSplit } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { useElementWidth } from '@treDeSpaceUI/lib';
import { EmptyState } from '@treDeSpaceUI/widgets';
import { useRef } from 'react';
import { autoTheme } from '../../../lib/overlay/overlayPresets';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { settingsState } from '../settings/settings.state';
import { OverlayPreview } from './OverlayPreview';
import { PreviewSampleFields } from './PreviewSampleFields';

/** Narrower than this, the sample fields go under the preview. */
const SIDE_BY_SIDE_PX = 560;

/** Live preview of the component open in the Overlay Editor. */
export function OverlayPreviewPanel() {
  useMinSize(240, 160);
  const s = overlayEditorState.use();
  const doc = animationDocState.use().doc;
  const themes = overlayLibraryState.use().themes;
  // one stable measured element in every state, so the width hook keeps it
  const ref = useRef<HTMLDivElement>(null);
  const isWide = useElementWidth(ref) >= SIDE_BY_SIDE_PX;
  const w = s.working;
  const app = settingsState.useSelect((x) => x.theme);
  const theme = s.theme ? (themes.find((t) => t.id === s.theme) ?? null) : autoTheme(app, themes);
  const uses = w ? doc.overlayInstances.filter((i) => i.component === w.id).length : 0;

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 overflow-hidden p-2">
      {w && (
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate font-medium text-slate-200">{w.name}</span>
          {s.dirty && <span className="shrink-0 text-amber-400">unsaved</span>}
          <span className="ml-auto shrink-0 text-[11px] text-slate-500">Used by {uses} overlay(s)</span>
        </div>
      )}
      <div
        ref={ref}
        className={isWide ? 'flex min-h-0 flex-1 gap-2' : 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto'}
      >
        {w ? (
          <>
            <div className={isWide ? 'min-h-0 min-w-0 flex-1' : 'h-64 shrink-0'}>
              <OverlayPreview component={w} theme={theme} />
            </div>
            <div className={isWide ? 'w-72 shrink-0 overflow-y-auto' : ''}>
              <PreviewSampleFields component={w} />
            </div>
          </>
        ) : (
          <EmptyState layout="center" icon={<IconLayoutBoardSplit size={26} />}>
            Open a component in the Overlay Editor to see it here.
          </EmptyState>
        )}
      </div>
    </PanelBody>
  );
}
