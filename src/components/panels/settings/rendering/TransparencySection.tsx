import { Collapsible, NumberInput, RadioGroup } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Row } from '../Row';

type TransparencyMode = 'hash' | 'blend' | 'backdrop';

const transparencyModes = [
  { value: 'hash', label: 'Alpha hash', hint: 'converges with AA', shortcut: 'render.transparency.hash' },
  { value: 'blend', label: 'Blend', hint: 'unsorted', shortcut: 'render.transparency.blend' },
  {
    value: 'backdrop',
    label: 'Background',
    hint: 'solid, behind opaque',
    shortcut: 'render.transparency.backdrop',
  },
];

function transparencyMode(blend: boolean, backdrop: boolean): TransparencyMode {
  if (!blend) {
    return 'hash';
  }
  return backdrop ? 'backdrop' : 'blend';
}

/** Rendering → Transparency: alpha hash, unsorted blend, or the transparent
 *  items rendered solid as a backdrop behind everything opaque. */
export function TransparencySection() {
  const v = useViewer();

  return (
    <Collapsible
      title="Transparency"
      info={
        <>
          Blend draws transparent surfaces unsorted, which can have side effects: overlapping glass may blend in the
          wrong order and edges/AO can look off. Alpha hash avoids this and converges with AA. Background renders the
          items you set transparent SOLID, as a backdrop behind everything else: they never cover opaque geometry, so
          the transparency itself goes away and what you left opaque always stands in front — the "ghosted context"
          look, at the price of depth cues between the two groups. Clicks on backdrop items pick nothing. Fade sets how
          far backdrop colours move toward the canvas background: 0 keeps their own colours, 100 makes them flat
          silhouettes.
        </>
      }
    >
      <RadioGroup
        options={transparencyModes}
        value={transparencyMode(v.transparencyBlend, v.transparencyBackdrop)}
        onChange={(x) =>
          viewerActions.update({ transparencyBlend: x !== 'hash', transparencyBackdrop: x === 'backdrop' })
        }
      />
      <Row label="Background fade">
        <NumberInput
          value={v.backdropFadePct}
          min={0}
          max={100}
          step={5}
          unit="%"
          disabled={!(v.transparencyBlend && v.transparencyBackdrop)}
          decShortcut="render.backdropFade.dec"
          incShortcut="render.backdropFade.inc"
          onChange={(x) => viewerActions.update({ backdropFadePct: x })}
        />
      </Row>
    </Collapsible>
  );
}
