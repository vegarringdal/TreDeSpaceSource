import { IconPresentation } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { presentActions } from '../../../state/animation/present.actions';
import { ScenePicker } from './ScenePicker';
import { TimelineExportMenu } from './TimelineExportMenu';
import { TimelineKeyTools } from './TimelineKeyTools';
import { TimelineLookTools } from './TimelineLookTools';
import { TimelineOverlayMenu } from './TimelineOverlayMenu';
import { TimelineTransport } from './TimelineTransport';
import { TimelineViewKeys } from './TimelineViewKeys';
import { TimelineViewTools } from './TimelineViewTools';

const SEP = <span className="mx-0.5 h-4 w-px bg-slate-700" />;

/** Everything while animating: scene, objects and keys, transport, view,
 *  export — without the editing tools while playing back only. */
export function TimelineToolbar({ scene, duration, editing }: { scene: Scene; duration: number; editing: boolean }) {
  return (
    <div
      role="toolbar"
      aria-label="Timeline toolbar"
      className="flex shrink-0 flex-wrap items-center gap-1 border-slate-800 border-b p-1"
    >
      <ScenePicker />
      {SEP}
      {editing && (
        <>
          <TimelineKeyTools />
          {SEP}
          <TimelineLookTools scene={scene} />
          <TimelineOverlayMenu />
          <TimelineViewKeys />
          {SEP}
        </>
      )}
      <TimelineTransport scene={scene} duration={duration} />
      {SEP}
      <TimelineViewTools />
      <span className="flex-1" />
      <Button
        iconOnly
        size="sm"
        icon={<IconPresentation />}
        tooltip="Present: the 3D view alone with the play bar — Close on the play bar comes back here"
        shortcut="animation.present"
        onClick={() => void presentActions.enter()}
      />
      <TimelineExportMenu />
    </div>
  );
}
