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
    label: 'Gray',
    tooltip: 'Gray: plain paper and ink edges, no mesh colours',
    shortcut: 'view.sketchColor.off',
  },
  {
    mode: 'fill',
    label: 'Fill',
    tooltip: 'Fill: wash the mesh colours onto the paper (colourless meshes stay paper)',
    shortcut: 'view.sketchColor.fill',
  },
  {
    mode: 'edges',
    label: 'Color',
    tooltip: 'Color: the ink takes the mesh colour (colourless meshes keep the sketch ink)',
    shortcut: 'view.sketchColor.edges',
  },
];

const SELECTION_STYLES: readonly { style: SelectionStyle; label: string; tooltip: string; shortcut: string }[] = [
  {
    style: 'tint',
    label: 'Tint',
    tooltip: 'Show the selection as a colour tint only',
    shortcut: 'render.outline.styleTint',
  },
  {
    style: 'outline',
    label: 'Outline',
    tooltip: 'Show the selection as an outline only (items keep their true colours)',
    shortcut: 'render.outline.styleOutline',
  },
  {
    style: 'both',
    label: 'Both',
    tooltip: 'Show the selection as both a colour tint and an outline',
    shortcut: 'render.outline.styleBoth',
  },
];

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** Two sections: Sketch (the toggle and its three colour modes) and Selection
 *  (how a selection shows: tint / outline / both). */
export function HomeViewGroups() {
  const { sketch, sketchColorMode, selectionStyle } = viewerState.use();

  return (
    <>
      <RibbonSection title="Sketch">
        <RibbonButton
          icon={<IconPencil />}
          label="On"
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
      </RibbonSection>
      <RibbonSection title="Selection" fill>
        {SELECTION_STYLES.map((st) => (
          <RibbonButton
            key={st.style}
            size="mini"
            label={st.label}
            selected={selectionStyle === st.style}
            tooltip={st.tooltip}
            shortcut={st.shortcut}
            onClick={() => viewerState.set({ selectionStyle: st.style })}
          />
        ))}
      </RibbonSection>
    </>
  );
}
