import { Collapsible, ColorSelect, NumberInput, RadioGroup } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';

/** Rendering → Background & selection colors plus the outline effect tuning. */
export function SelectionSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <>
      <Collapsible title="Background & selection">
        <Row label="Background">
          <ColorSelect value={v.bgColor} onChange={(x) => act.update({ bgColor: x })} />
        </Row>
        <Row label="Selection colour">
          <ColorSelect value={v.selectionColor} onChange={(x) => act.update({ selectionColor: x })} />
        </Row>
        <div className="mt-1 text-slate-400 text-xs">Selection style</div>
        <RadioGroup
          options={[
            { value: 'tint', label: 'Tint', hint: 'color only', shortcut: 'render.outline.styleTint' },
            {
              value: 'outline',
              label: 'Outline',
              hint: 'edges only, keeps true colors',
              shortcut: 'render.outline.styleOutline',
            },
            { value: 'both', label: 'Both', shortcut: 'render.outline.styleBoth' },
          ]}
          value={v.selectionStyle}
          onChange={(x) => act.update({ selectionStyle: (x ?? 'tint') as 'tint' | 'outline' | 'both' })}
        />
      </Collapsible>

      <Collapsible
        title="Outline (selection & hover)"
        info={
          <>
            Outlines the hovered item and/or the selection (see Selection style above) — visible edges in one color,
            occluded parts in the other, like the three.js outline pass. Works on any surface color; pulse animates the
            strength.
          </>
        }
      >
        <Check
          label="Hover outline"
          checked={v.outlineHover}
          shortcut="render.outline.hover"
          onChange={(x) => act.update({ outlineHover: x })}
        />
        <Row label="Strength">
          <NumberInput
            value={v.outlineStrength}
            min={0}
            max={10}
            step={0.5}
            onChange={(x) => act.update({ outlineStrength: x })}
            decShortcut="render.outline.strength.dec"
            incShortcut="render.outline.strength.inc"
          />
        </Row>
        <Row label="Glow">
          <NumberInput
            value={v.outlineGlow}
            min={0}
            max={1}
            step={0.1}
            onChange={(x) => act.update({ outlineGlow: x })}
            decShortcut="render.outline.glow.dec"
            incShortcut="render.outline.glow.inc"
          />
        </Row>
        <Row label="Thickness">
          <NumberInput
            value={v.outlineThickness}
            min={1}
            max={4}
            step={1}
            onChange={(x) => act.update({ outlineThickness: x })}
            decShortcut="render.outline.thickness.dec"
            incShortcut="render.outline.thickness.inc"
          />
        </Row>
        <Row label="Pulse (s)">
          <NumberInput
            value={v.outlinePulse}
            min={0}
            max={5}
            step={0.5}
            onChange={(x) => act.update({ outlinePulse: x })}
            decShortcut="render.outline.pulse.dec"
            incShortcut="render.outline.pulse.inc"
          />
        </Row>
        <Row label="Visible edge">
          <ColorSelect value={v.outlineVisibleColor} onChange={(x) => act.update({ outlineVisibleColor: x })} />
        </Row>
        <Row label="Hidden edge">
          <ColorSelect value={v.outlineHiddenColor} onChange={(x) => act.update({ outlineHiddenColor: x })} />
        </Row>
      </Collapsible>
    </>
  );
}
