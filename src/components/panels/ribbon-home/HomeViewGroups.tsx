import { IconPencil } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type SketchColorMode, viewerState } from '../../../state/viewer/viewer.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type SelectionStyle = 'tint' | 'outline' | 'both';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SKETCH_COLOR_MODES: readonly { mode: SketchColorMode; label: string; tooltip: string; shortcut: string }[] = [
  {
    mode: 'off',
    label: 'Wire',
    tooltip: 'Wire: plain paper and ink edges, no mesh colours',
    shortcut: 'view.sketchColor.off',
  },
  {
    mode: 'fill',
    label: 'Colour fill',
    tooltip: 'Colour fill: wash the mesh colours onto the paper (colourless meshes stay paper)',
    shortcut: 'view.sketchColor.fill',
  },
  {
    mode: 'edges',
    label: 'Colour wire',
    tooltip: 'Colour wire: the ink takes the mesh colour (colourless meshes keep the sketch ink)',
    shortcut: 'view.sketchColor.edges',
  },
];

const SELECTION_STYLES: readonly { style: SelectionStyle; label: string; tooltip: string; shortcut: string }[] = [
  {
    style: 'tint',
    label: 'Selection tint',
    tooltip: 'Show the selection as a colour tint only',
    shortcut: 'render.outline.styleTint',
  },
  {
    style: 'outline',
    label: 'Selection outline',
    tooltip: 'Show the selection as an outline only (items keep their true colours)',
    shortcut: 'render.outline.styleOutline',
  },
  {
    style: 'both',
    label: 'Selection both',
    tooltip: 'Show the selection as both a colour tint and an outline',
    shortcut: 'render.outline.styleBoth',
  },
];

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The Draw Mode group: the sketch toggle, its three colour modes and the
 *  selection style (tint / outline / both). */
export function HomeViewGroups() {
  const { sketch, sketchColorMode, selectionStyle } = viewerState.use();

  return (
    <RibbonSection title="Draw Mode">
      <RibbonButton
        icon={<IconPencil />}
        label="Sketch"
        selected={sketch}
        tooltip="Sketch mode: white background with black edge lines only (labels/measurements stay visible; screenshots capture the sketch look). Transparent items are not included — they produce no edges."
        shortcut="view.sketch"
        onClick={() => viewerState.set({ sketch: !sketch })}
      />
      {SKETCH_COLOR_MODES.map((m) => (
        <RibbonButton
          key={m.mode}
          size="mini"
          label={m.label}
          selected={sketchColorMode === m.mode}
          tooltip={m.tooltip}
          shortcut={m.shortcut}
          onClick={() => viewerState.set({ sketchColorMode: m.mode })}
        />
      ))}
      {SELECTION_STYLES.map((s) => (
        <RibbonButton
          key={s.style}
          size="mini"
          label={s.label}
          selected={selectionStyle === s.style}
          tooltip={s.tooltip}
          shortcut={s.shortcut}
          onClick={() => viewerState.set({ selectionStyle: s.style })}
        />
      ))}
    </RibbonSection>
  );
}
