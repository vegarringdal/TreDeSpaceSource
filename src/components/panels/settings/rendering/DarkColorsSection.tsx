import { Collapsible, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';

/** Rendering → Dark colours: render pure-black material colours as grey so
 *  the headlight has something to shade. */
export function DarkColorsSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <Collapsible
      title="Dark colours"
      info={
        <>
          Some models arrive with black material colours, and a black surface shows no shading at all — there is nothing
          for the light to modulate, so shape and depth vanish. With this on, a cooked colour that is exactly black is
          rendered as a grey of the level below. Only pure black is touched: dark navy, brown or charcoal are deliberate
          colours and stay as they are. Rendering only: exports, the hierarchy and colour overrides you set yourself
          keep the true colours.
        </>
      }
    >
      <Check
        label="Lift black color to grey"
        tooltip="Render pure-black material colours as grey so their shading shows; other dark colours, the cooked colours and exports are untouched"
        shortcut="render.darkLift"
        checked={v.darkLift}
        onChange={(x) => act.update({ darkLift: x })}
      />
      <Row label="Grey level">
        <NumberInput
          value={v.darkLiftPct}
          min={0}
          max={100}
          step={5}
          unit="%"
          decShortcut="render.darkLift.dec"
          incShortcut="render.darkLift.inc"
          onChange={(x) => act.update({ darkLiftPct: x })}
        />
      </Row>
    </Collapsible>
  );
}
