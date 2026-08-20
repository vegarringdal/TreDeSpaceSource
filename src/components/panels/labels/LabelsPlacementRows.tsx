import {
  IconBox,
  IconDeselect,
  IconEye,
  IconEyeOff,
  IconListSearch,
  IconMapPinPlus,
  IconSelectAll,
  IconSwitchHorizontal,
  IconTrash,
} from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { clipShapesState } from '../../../state/viewer/clipShapes.state';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState, MAX_LABELS } from '../../../state/viewer/labels.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';

/** Labels → Common, rows 1-3: place/mute, highlight the linked items in the
 *  model, and the label-selection actions (select/deselect/invert/delete). */
export function LabelsPlacementRows() {
  const s = labelsState.use();
  const selCount = s.items.filter((l) => l.selected).length;
  const clipBox = ribbonClippingBoxState.use();
  const clipShapes = clipShapesState.use();
  // mirrors activeClipVolumes' gating — drives the Select bbox disabled state
  const hasClipVolumes =
    clipBox.enabled &&
    (clipBox.boxOn || (!clipShapes.muted && clipShapes.shapes.slice(0, 7).some((x) => x.enabled)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconMapPinPlus size={14} />}
          active={s.placing}
          disabled={s.items.length >= MAX_LABELS}
          tooltip="Arm placement — the next click in the viewport creates a label there"
          shortcut="labels.new"
          onClick={act.startPlacing}
        >
          New label
        </Button>
        <Button
          icon={s.muted ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          active={s.muted}
          tooltip="Hide/show all labels in the viewport (items are kept). Show all also unmutes individually muted labels"
          shortcut="labels.muteAll"
          onClick={act.toggleMuted}
        >
          {s.muted ? 'Show all' : 'Mute all'}
        </Button>
        <Button
          icon={<IconEyeOff size={14} />}
          disabled={selCount === 0}
          tooltip="Hide the selected labels in the viewport (items are kept). Press again on an all-muted selection to show them"
          shortcut="labels.muteSelected"
          onClick={act.muteSelected}
        >
          Mute sel.
        </Button>
        <Button
          icon={<IconTrash size={14} />}
          disabled={s.items.length === 0}
          tooltip="Delete every label"
          shortcut="labels.clear"
          onClick={act.clearAll}
        >
          Delete all
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconListSearch size={14} />}
          disabled={!s.items.some((l) => l.selected && l.fullname)}
          tooltip="Highlight the linked items (by fullname) of the selected labels in the tree/model"
          shortcut="labels.selectLinked"
          onClick={() =>
            void viewerActions.selectByFullnames(s.items.flatMap((l) => (l.selected && l.fullname ? [l.fullname] : [])))
          }
        >
          Highlight sel.
        </Button>
        <Button
          icon={<IconListSearch size={14} />}
          disabled={!s.items.some((l) => l.fullname)}
          tooltip="Highlight ALL labels' linked items (by fullname) in the tree/model"
          shortcut="labels.selectAll"
          onClick={() => void viewerActions.selectByFullnames(s.items.flatMap((l) => (l.fullname ? [l.fullname] : [])))}
        >
          Highlight all
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconSelectAll size={14} />}
          disabled={s.items.length === 0 || selCount === s.items.length}
          tooltip="Select every label"
          shortcut="labels.selectAllLabels"
          onClick={act.selectAllLabels}
        >
          Select all
        </Button>
        <Button
          icon={<IconDeselect size={14} />}
          disabled={selCount === 0}
          tooltip="Clear the label selection"
          shortcut="labels.deselectAll"
          onClick={act.deselectAllLabels}
        >
          Deselect all
        </Button>
        <Button
          icon={<IconBox size={14} />}
          disabled={s.items.length === 0 || !hasClipVolumes}
          tooltip="Select every label inside the clipping box or an enabled clip shape (geometric inside — invert is ignored)"
          shortcut="labels.selectInsideClip"
          onClick={act.selectInsideClip}
        >
          Select bbox
        </Button>
        <Button
          icon={<IconEyeOff size={14} />}
          disabled={s.items.length === 0 || !hasClipVolumes}
          tooltip="Hide every label outside the clipping box / enabled clip shapes (labels inside are shown). Show all brings them back"
          shortcut="labels.muteOutsideClip"
          onClick={act.muteOutsideClip}
        >
          Hide outside bbox
        </Button>
        <Button
          icon={<IconSwitchHorizontal size={14} />}
          disabled={s.items.length === 0}
          tooltip="Invert which labels are selected"
          shortcut="labels.invert"
          onClick={act.invertSelection}
        >
          Invert sel.
        </Button>
        <Button
          icon={<IconTrash size={14} />}
          disabled={selCount === 0}
          tooltip="Delete the selected labels"
          shortcut="labels.deleteSelected"
          onClick={act.removeSelected}
        >
          Delete sel.
        </Button>
      </div>
    </>
  );
}
