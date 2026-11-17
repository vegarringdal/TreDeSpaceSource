import { IconFoldDown, IconFoldUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { selectionState } from '../../../state/viewer/selection.state';
import { transformObjectsUiActions as ui } from './transformObjectsUi.actions';

const ICON = 14;

/** New object from the selection, save / load of the object list, delete
 *  all, and collapse / expand of every row of the list below. */
export function TransformObjectsFilesSection({
  openPicker,
  pickerElement,
}: {
  openPicker: () => void;
  pickerElement: ReactNode;
}) {
  const count = transformState.useSelect((s) => s.objects.length);
  const hasSelection = selectionState.useSelect((s) => s.count > 0);
  const isResting = useTransformResting();

  return (
    <Collapsible
      title="Objects & files"
      info="Select items and press New Object: the object is what the Transform ribbon and the gizmo then move. Save writes every object — its items by name, its pose, what it rides on — to a JSON file; Load brings a list back, also after the model was imported again."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<IconPlus size={ICON} />}
          variant="primary"
          disabled={!hasSelection || isResting}
          onClick={() => void act.newFromSelection()}
          tooltip="Make the selection a transform object. A selection inside another object rides on it."
          shortcut="transform.object.new"
        >
          New Object
        </Button>
        <Button
          disabled={count === 0}
          onClick={() => act.downloadJson()}
          tooltip="Save all transform objects to a JSON file"
          shortcut="transform.save"
        >
          Save…
        </Button>
        <Button
          disabled={isResting}
          onClick={openPicker}
          tooltip="Load transform objects from a JSON file"
          shortcut="transform.load"
        >
          Load…
        </Button>
        <Button
          icon={<IconTrash size={ICON} />}
          disabled={count === 0 || isResting}
          onClick={() => act.clear()}
          tooltip="Delete every transform object — the items go back where the model has them"
          shortcut="transform.clearAll"
        >
          Delete all
        </Button>
        <Button
          iconOnly
          icon={<IconFoldUp size={ICON} />}
          disabled={count === 0}
          onClick={() => ui.setAllOpen(false)}
          tooltip="Collapse all: close every object's row"
          shortcut="transform.list.collapseAll"
        />
        <Button
          iconOnly
          icon={<IconFoldDown size={ICON} />}
          disabled={count === 0}
          onClick={() => ui.setAllOpen(true)}
          tooltip="Expand all: open every object's row"
          shortcut="transform.list.expandAll"
        />
        {pickerElement}
      </div>
    </Collapsible>
  );
}
