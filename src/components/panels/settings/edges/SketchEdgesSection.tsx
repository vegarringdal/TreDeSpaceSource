import { Checkbox, ColorSelect, RadioGroup, type RadioOption } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer, type ViewerState } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';
import { EdgeTuning } from './EdgeTuning';

const colorModes: readonly RadioOption<ViewerState['sketchColorMode']>[] = [
  { value: 'off', label: 'Wire', hint: 'plain paper and ink', shortcut: 'render.sketchColor.off' },
  {
    value: 'fill',
    label: 'Colour fill',
    hint: 'wash mesh colours onto the paper',
    shortcut: 'render.sketchColor.fill',
  },
  { value: 'edges', label: 'Colour wire', hint: 'ink takes the mesh colour', shortcut: 'render.sketchColor.edges' },
];

/** Edges → Sketch: the white-background edge-only mode and its own palette. */
export function SketchEdgesSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <SettingsSection
      id="sketchEdges"
      title="Sketch edges"
      info={
        <>
          Edge tuning used while <b>Sketch</b> mode is on (Home ribbon) — white background with edge lines only. These
          replace the normal edge settings above for the sketch look.
        </>
      }
    >
      <Checkbox
        label="Sketch mode"
        checked={v.sketch}
        shortcut="view.sketch"
        onChange={(x) => act.update({ sketch: x })}
      />
      <Checkbox
        label="Respect edge-off switches"
        checked={v.sketchRespectsEdgesOff}
        shortcut="render.sketchRespectsEdgesOff"
        onChange={(x) => act.update({ sketchRespectsEdgesOff: x })}
      />
      <div className="text-slate-400 text-xs">Colour from mesh (colourless stays paper)</div>
      <RadioGroup
        options={colorModes}
        value={v.sketchColorMode}
        onChange={(sketchColorMode) => act.update({ sketchColorMode })}
      />
      <ColorSelect
        label="Edge colour"
        labelPosition="split"
        value={v.sketchEdgeColor}
        onChange={(x) => act.update({ sketchEdgeColor: x })}
      />
      <ColorSelect
        label="Cube faces"
        labelPosition="split"
        value={v.sketchCubeFaceColor}
        onChange={(x) => act.update({ sketchCubeFaceColor: x })}
      />
      <ColorSelect
        label="Cube lines"
        labelPosition="split"
        value={v.sketchCubeLineColor}
        onChange={(x) => act.update({ sketchCubeLineColor: x })}
      />
      <ColorSelect
        label="Cube text"
        labelPosition="split"
        value={v.sketchCubeTextColor}
        onChange={(x) => act.update({ sketchCubeTextColor: x })}
      />
      <ColorSelect
        label="Cube hover"
        labelPosition="split"
        value={v.sketchCubeHoverColor}
        onChange={(x) => act.update({ sketchCubeHoverColor: x })}
      />
      <EdgeTuning
        fade={{
          value: v.sketchFadeExp,
          onChange: (x) => act.update({ sketchFadeExp: x }),
          decShortcut: 'render.sketchFade.dec',
          incShortcut: 'render.sketchFade.inc',
        }}
        depth={{
          value: v.sketchDepthThr,
          onChange: (x) => act.update({ sketchDepthThr: x }),
          decShortcut: 'render.sketchDepth.dec',
          incShortcut: 'render.sketchDepth.inc',
        }}
        normal={{
          value: v.sketchNormalThr,
          onChange: (x) => act.update({ sketchNormalThr: x }),
          decShortcut: 'render.sketchNormal.dec',
          incShortcut: 'render.sketchNormal.inc',
        }}
      />
    </SettingsSection>
  );
}
