import { IconFileTypePdf, IconSparkles, IconVideo } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { claudeActions } from '../../../state/animation/claude.actions';
import { stillsActions } from '../../../state/animation/stills.actions';
import { videoExportActions } from '../../../state/animation/videoExport.actions';

/** Export: the video, step stills, and the brief an AI (Claude Code) builds
 *  an animation file from. The item lists are shortcuts only (ALT 1550–1552). */
export function AnimExportGroups() {
  return (
    <RibbonSection title="Export">
      <RibbonButton
        size="mini"
        icon={<IconVideo />}
        label="Video"
        tooltip="The scene as an .mp4, rendered frame by frame"
        shortcut="animation.video.open"
        onClick={() => void videoExportActions.open()}
      />
      <RibbonButton
        size="mini"
        icon={<IconFileTypePdf />}
        label="Step stills"
        tooltip="A PDF with the last frame of each step (everything in place), its name and text — work instructions"
        shortcut="animation.stills.export"
        onClick={() => void stillsActions.exportStepStills()}
      />
      <RibbonButton
        size="mini"
        icon={<IconSparkles />}
        label="Brief for AI"
        tooltip="Download the brief an AI (Claude Code) writes an animation file from: what to ask you, the format, patterns, your cards and a schema"
        shortcut="animation.claude.brief"
        onClick={claudeActions.brief}
      />
    </RibbonSection>
  );
}
