import { IconShape } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { faceLetters, type GizmoFaceName, gizmoLabelsState } from '../../../state/viewer/gizmoLabels.state';
import { ribbonClippingBoxActions as act } from './ribbonClippingBox.actions';
import { ribbonClippingBoxState } from './ribbonClippingBox.state';

// action keys stay fixed; the displayed letters follow the gizmo face names.
// L/R red, F/B green, Bt/T blue — matching the CAD reference.
const FACES: Array<{ key: string; face: GizmoFaceName; color: string }> = [
  { key: 'L', face: 'left', color: '#ef4444' },
  { key: 'R', face: 'right', color: '#ef4444' },
  { key: 'F', face: 'front', color: '#16a34a' },
  { key: 'B', face: 'back', color: '#16a34a' },
  { key: 'Bt', face: 'bottom', color: '#3b82f6' },
  { key: 'T', face: 'top', color: '#3b82f6' },
];

/** Per-face resize and move buttons for the clipping box, plus the step size
 *  and the shapes helper. */
export function ClipBoxFaceGroups() {
  const s = ribbonClippingBoxState.use();
  const labels = gizmoLabelsState.use().labels;
  const letters = faceLetters(labels);

  return (
    <>
      <RibbonSection title="Resize">
        {FACES.flatMap(({ key, face, color }) =>
          ['+', '−'].map((sign) => (
            <RibbonButton
              key={key + sign}
              size="medium"
              background={color}
              label={letters[face] + sign}
              className="!w-auto !px-0 !justify-center aspect-square min-w-0"
              tooltip={`${sign === '+' ? 'Grow' : 'Shrink'} the box through its ${labels[face]} face`}
              onClick={() => act.resize(key + (sign === '+' ? '+' : '-'))}
            />
          )),
        )}
      </RibbonSection>

      <RibbonSection title="Step">
        <RibbonNumber
          size="medium"
          unit="m"
          min={0.1}
          step={0.1}
          precision={1}
          value={s.step}
          decShortcut="clip.box.step.dec"
          incShortcut="clip.box.step.inc"
          onChange={act.setStep}
        />
      </RibbonSection>

      <RibbonSection title="Move">
        {FACES.map(({ key, face, color }) => (
          <RibbonButton
            key={key}
            size="medium"
            background={color}
            label={letters[face]}
            className="!w-auto !px-0 !justify-center aspect-square min-w-0"
            tooltip={`Move the whole box one step toward ${labels[face]}`}
            onClick={() => act.move(key)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Additional">
        <RibbonButton
          icon={<IconShape />}
          label="Shapes"
          tooltip="Open the Clip Shapes panel — sphere / cylinder / box clip volumes beyond the default box"
          shortcut="clipShapes.open"
          onClick={act.shapes}
        />
      </RibbonSection>
    </>
  );
}
