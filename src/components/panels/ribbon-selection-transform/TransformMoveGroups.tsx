import { IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { faceLetters, type GizmoFaceName, gizmoLabelsState } from '../../../state/viewer/gizmoLabels.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';

const MOVE: Array<{ key: string; face: GizmoFaceName; color: string }> = [
  { key: 'R', face: 'right', color: '#ef4444' },
  { key: 'L', face: 'left', color: '#ef4444' },
  { key: 'B', face: 'back', color: '#16a34a' },
  { key: 'F', face: 'front', color: '#16a34a' },
  { key: 'T', face: 'top', color: '#3b82f6' },
  { key: 'Bt', face: 'bottom', color: '#3b82f6' },
];

// 90° reorientations, labeled from the gizmo face names (from -> to)
const ROTATE: Array<{ key: string; from: GizmoFaceName; to: GizmoFaceName; color: string }> = [
  { key: 'topToFront', from: 'top', to: 'front', color: '#ef4444' },
  { key: 'topToBack', from: 'top', to: 'back', color: '#ef4444' },
  { key: 'topToLeft', from: 'top', to: 'left', color: '#16a34a' },
  { key: 'topToRight', from: 'top', to: 'right', color: '#16a34a' },
  { key: 'frontToRight', from: 'front', to: 'right', color: '#3b82f6' },
  { key: 'frontToLeft', from: 'front', to: 'left', color: '#3b82f6' },
];

/** Face-labeled nudge, scale and 90° rotate buttons for the transform ribbon
 *  — off until the selection is a transform object (New Object). */
export function TransformMoveGroups() {
  const hasCurrent = transformState.useSelect((s) => s.currentId !== null);
  // off without a current object — and while animating, where objects rest
  const none = useTransformResting() || !hasCurrent;
  const labels = gizmoLabelsState.use().labels;
  const letters = faceLetters(labels);

  return (
    <>
      <RibbonSection title="Move">
        {MOVE.map(({ key, face, color }) => (
          <RibbonButton
            key={key}
            size="medium"
            label={letters[face]}
            background={color}
            className="!w-auto !px-0 !justify-center aspect-square min-w-0"
            tooltip={`Move one step toward ${labels[face]}`}
            disabled={none}
            shortcut={`transform.nudge.${key}`}
            onClick={() => act.nudge(key)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Scale">
        <RibbonButton
          size="medium"
          icon={<IconZoomIn />}
          label="Bigger"
          tooltip="Grow the object evenly: its largest side gets one step longer"
          disabled={none}
          shortcut="transform.scale.bigger"
          onClick={() => act.scale(1)}
        />
        <RibbonButton
          size="medium"
          icon={<IconZoomOut />}
          label="Smaller"
          tooltip="Shrink the object evenly: its largest side gets one step shorter"
          disabled={none}
          shortcut="transform.scale.smaller"
          onClick={() => act.scale(-1)}
        />
      </RibbonSection>

      <RibbonSection title="Rotate">
        {ROTATE.map(({ key, from, to, color }) => (
          <RibbonButton
            key={key}
            size="mini"
            label={`${letters[from]}→${letters[to]}`}
            background={color}
            className="!px-1 !justify-center min-w-12"
            tooltip={`Rotate 90° so ${labels[from]} faces ${labels[to]}`}
            disabled={none}
            shortcut={`transform.rotate.${key}`}
            onClick={() => act.rotate(key)}
          />
        ))}
      </RibbonSection>
    </>
  );
}
