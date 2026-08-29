import { IconCube, IconMoon, IconPencil, IconPerspective, IconSun } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type SketchColorMode, viewerState } from '../../../state/viewer/viewer.state';
import { settingsActions } from '../settings/settings.actions';
import { settingsState } from '../settings/settings.state';
import { ribbonHomeActions as act } from './ribbonHome.actions';
import { ribbonHomeState } from './ribbonHome.state';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SKETCH_COLOR_MODES: readonly { mode: SketchColorMode; label: string; tooltip: string; shortcut: string }[] = [
  {
    mode: 'off',
    label: 'Off',
    tooltip: 'Sketch colour off: plain paper and ink',
    shortcut: 'view.sketchColor.off',
  },
  {
    mode: 'fill',
    label: 'Fill',
    tooltip: 'Sketch colour fill: wash the mesh colours onto the paper (colourless meshes stay paper)',
    shortcut: 'view.sketchColor.fill',
  },
  {
    mode: 'edges',
    label: 'Edges',
    tooltip: 'Sketch colour edges: the ink takes the mesh colour (colourless meshes keep the sketch ink)',
    shortcut: 'view.sketchColor.edges',
  },
];

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** Theme toggle, the Sketch group (mode + its three colour modes) and the
 *  perspective/ortho camera mode switch. */
export function HomeViewGroups() {
  const s = ribbonHomeState.use();
  const dark = settingsState.use().theme === 'dark';
  const { sketch, sketchColorMode } = viewerState.use();

  return (
    <>
      <RibbonSection title="View">
        <RibbonButton
          icon={dark ? <IconSun /> : <IconMoon />}
          label={dark ? 'Light' : 'Dark'}
          tooltip={`Switch to the ${dark ? 'light' : 'dark'} theme`}
          shortcut="view.theme.toggle"
          onClick={settingsActions.toggleTheme}
        />
      </RibbonSection>

      <RibbonSection title="Sketch">
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
      </RibbonSection>

      <RibbonSection title="Camera Mode">
        <RibbonButton
          icon={<IconPerspective />}
          label="Persp."
          selected={s.camera === 'persp'}
          shortcut="camera.persp"
          onClick={() => act.setCamera('persp')}
        />
        <RibbonButton
          icon={<IconCube />}
          label="Ortho"
          selected={s.camera === 'ortho'}
          shortcut="camera.ortho"
          onClick={() => act.setCamera('ortho')}
        />
      </RibbonSection>
    </>
  );
}
