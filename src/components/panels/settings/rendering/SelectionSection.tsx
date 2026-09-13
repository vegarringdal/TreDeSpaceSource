import { Checkbox, ColorSelect, NumberInput, RadioGroup, type RadioOption } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer, type ViewerState } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';

const SELECTION_STYLES: readonly RadioOption<ViewerState['selectionStyle']>[] = [
  { value: 'tint', label: 'Tint', hint: 'color only', shortcut: 'render.outline.styleTint' },
  {
    value: 'outline',
    label: 'Outline',
    hint: 'edges only, keeps true colors',
    shortcut: 'render.outline.styleOutline',
  },
  { value: 'both', label: 'Both', shortcut: 'render.outline.styleBoth' },
];

/** Rendering → Background & selection colors plus the outline effect tuning. */
export function SelectionSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <>
      <SettingsSection
        id="selection"
        title="Background & selection"
        info={
          <>
            The canvas colour, the tint a selected item gets, and whether a selection shows as a tint, an outline, or
            both — the outline itself is tuned in the section below.
          </>
        }
      >
        <ColorSelect
          label="Background"
          labelPosition="split"
          value={v.bgColor}
          onChange={(x) => act.update({ bgColor: x })}
        />
        <ColorSelect
          label="Selection colour"
          labelPosition="split"
          value={v.selectionColor}
          onChange={(x) => act.update({ selectionColor: x })}
        />
        <div className="mt-1 text-slate-400 text-xs">Selection style</div>
        <RadioGroup
          options={SELECTION_STYLES}
          value={v.selectionStyle}
          onChange={(selectionStyle) => act.update({ selectionStyle })}
        />
      </SettingsSection>

      <SettingsSection
        id="outline"
        title="Outline (selection & hover)"
        info={
          <>
            Outlines the hovered item and/or the selection (see Selection style above) — visible edges in one color,
            occluded parts in the other, like the three.js outline pass. Works on any surface color; pulse animates the
            strength.
          </>
        }
      >
        <Checkbox
          label="Hover outline"
          checked={v.outlineHover}
          shortcut="render.outline.hover"
          onChange={(x) => act.update({ outlineHover: x })}
        />
        <NumberInput
          label="Strength"
          labelPosition="split"
          value={v.outlineStrength}
          min={0}
          max={10}
          step={0.5}
          onChange={(x) => act.update({ outlineStrength: x })}
          decShortcut="render.outline.strength.dec"
          incShortcut="render.outline.strength.inc"
        />
        <NumberInput
          label="Glow"
          labelPosition="split"
          value={v.outlineGlow}
          min={0}
          max={1}
          step={0.1}
          onChange={(x) => act.update({ outlineGlow: x })}
          decShortcut="render.outline.glow.dec"
          incShortcut="render.outline.glow.inc"
        />
        <NumberInput
          label="Thickness"
          labelPosition="split"
          value={v.outlineThickness}
          min={1}
          max={4}
          step={1}
          onChange={(x) => act.update({ outlineThickness: x })}
          decShortcut="render.outline.thickness.dec"
          incShortcut="render.outline.thickness.inc"
        />
        <NumberInput
          label="Pulse (s)"
          labelPosition="split"
          value={v.outlinePulse}
          min={0}
          max={5}
          step={0.5}
          onChange={(x) => act.update({ outlinePulse: x })}
          decShortcut="render.outline.pulse.dec"
          incShortcut="render.outline.pulse.inc"
        />
        <ColorSelect
          label="Visible edge"
          labelPosition="split"
          value={v.outlineVisibleColor}
          onChange={(x) => act.update({ outlineVisibleColor: x })}
        />
        <ColorSelect
          label="Hidden edge"
          labelPosition="split"
          value={v.outlineHiddenColor}
          onChange={(x) => act.update({ outlineHiddenColor: x })}
        />
      </SettingsSection>
    </>
  );
}
