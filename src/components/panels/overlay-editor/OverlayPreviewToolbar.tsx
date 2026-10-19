import { IconPlayerPlay } from '@tabler/icons-react';
import { Button, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { useOverlayThemeOptions } from '../shared/useOverlayThemeOptions';

const HEIGHTS = [
  { value: 'fit', label: 'Fit', tooltip: 'Zoom the card to fill the preview', shortcut: 'overlay.preview.height.fit' },
  {
    value: '720',
    label: '720p',
    tooltip: 'Real size on a 720-pixel-high screen',
    shortcut: 'overlay.preview.height.720',
  },
  {
    value: '1080',
    label: '1080p',
    tooltip: 'Real size on a 1080-pixel-high screen',
    shortcut: 'overlay.preview.height.1080',
  },
  {
    value: '1440',
    label: '1440p',
    tooltip: 'Real size on a 1440-pixel-high screen',
    shortcut: 'overlay.preview.height.1440',
  },
] as const;

const BGS = [
  { value: 'dark', label: 'Dark', tooltip: 'Preview on a dark background', shortcut: 'overlay.preview.bg.dark' },
  { value: 'light', label: 'Light', tooltip: 'Preview on a light background', shortcut: 'overlay.preview.bg.light' },
  {
    value: 'checker',
    label: 'Checker',
    tooltip: 'Preview on a chequered background (shows transparency)',
    shortcut: 'overlay.preview.bg.checker',
  },
] as const;

function toPreviewHeight(v: string): 'fit' | 720 | 1080 | 1440 {
  return v === 'fit' ? 'fit' : v === '720' ? 720 : v === '1440' ? 1440 : 1080;
}

/** The Overlay Preview's zoom, background, theme and effect-replay row. */
export function OverlayPreviewToolbar({ onReplay }: { onReplay: () => void }) {
  const s = overlayEditorState.use();
  const themes = useOverlayThemeOptions();

  return (
    <div className="flex flex-wrap items-center gap-1">
      <SegmentedControl
        size="sm"
        value={String(s.previewHeight)}
        options={HEIGHTS}
        onChange={(v) => overlayEditorActions.setPreview({ previewHeight: toPreviewHeight(v) })}
      />
      <SegmentedControl
        size="sm"
        value={s.previewBg === 'scene' ? 'dark' : s.previewBg}
        options={BGS}
        onChange={(v) => overlayEditorActions.setPreview({ previewBg: v })}
      />
      <Select
        className="w-44"
        tooltip="The theme the preview shows — Auto is what overlays without a theme get: the app's light / dark theme"
        value={themes.toValue(s.theme)}
        options={themes.options}
        clearable={false}
        onChange={(v) => overlayEditorActions.setTheme(themes.fromValue(v))}
      />
      <Button
        size="sm"
        icon={<IconPlayerPlay />}
        tooltip="Replay the enter effect"
        shortcut="overlay.preview.replay"
        onClick={onReplay}
      >
        Effect
      </Button>
    </div>
  );
}
