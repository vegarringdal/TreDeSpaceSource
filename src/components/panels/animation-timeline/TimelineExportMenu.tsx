import { IconDownload } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import { claudeActions } from '../../../state/animation/claude.actions';
import { stillsActions } from '../../../state/animation/stills.actions';
import { videoExportActions } from '../../../state/animation/videoExport.actions';
import { useMenuAnchor } from '../shared/useMenuAnchor';

/** Export ▾: the video, step stills, and the brief for Claude. */
export function TimelineExportMenu() {
  const menu = useMenuAnchor('animation.menu.export');

  return (
    <>
      <span ref={menu.wrap} className="inline-flex">
        <Button
          size="sm"
          icon={<IconDownload />}
          tooltip="Export: a video, step stills or the brief for AI"
          shortcut="animation.menu.export"
          onClick={menu.open}
        >
          ▾
        </Button>
      </span>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        minWidth={240}
        items={[
          {
            id: 'video',
            label: 'Video (.mp4)…',
            tooltip: 'The scene rendered frame by frame',
            shortcut: 'animation.video.open',
            onSelect: () => void videoExportActions.open(),
          },
          {
            id: 'stills',
            label: 'Step stills (PDF)…',
            tooltip: 'The last frame of each step (everything in place), with its name and text — work instructions',
            shortcut: 'animation.stills.export',
            onSelect: () => void stillsActions.exportStepStills(),
          },
          { separator: true },
          {
            id: 'brief',
            label: 'Brief for AI…',
            tooltip:
              'A Markdown brief Claude Code writes an animation file from: what to ask you, the format, patterns, your cards and a schema',
            shortcut: 'animation.claude.brief',
            onSelect: claudeActions.brief,
          },
        ]}
      />
    </>
  );
}
