import { IconDownload, IconFileExport, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { dialogs } from '../../dialogs/dialogs.actions';

type StoreActionRowsProps = Readonly<{
  visibleIds: string[];
}>;

/** The destructive and load/export button rows, acting on the selected
 *  VISIBLE assets across every store (the search filter applies). To clear a
 *  whole store, click its section band (selects everything under it), then
 *  Delete. */
export function StoreActionRows({ visibleIds }: StoreActionRowsProps) {
  const handleDelete = () => {
    void dialogs
      .confirm(`Delete ${visibleIds.length} asset(s) from their store(s)?`, { okLabel: 'Delete' })
      .then((ok) => {
        if (ok) {
          void act.removeSelected(visibleIds);
        }
      });
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          icon={<IconTrash size={14} />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={visibleIds.length === 0}
          onClick={handleDelete}
          tooltip="Delete the selected VISIBLE assets from their stores (filter applies)"
        >
          Delete
        </Button>
        <Button
          icon={<IconDownload size={14} />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={visibleIds.length === 0}
          onClick={() => void act.loadSelected(visibleIds)}
          tooltip="Load the selected VISIBLE assets into the viewer (filter applies)"
        >
          Load
        </Button>
        <Button
          icon={<IconDownload size={14} className="rotate-180" />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={visibleIds.length === 0}
          onClick={() => void act.unloadSelected(visibleIds)}
          tooltip="Unload the selected VISIBLE assets from the viewer (files stay in the store)"
        >
          Unload
        </Button>
        <Button
          icon={<IconFileExport size={14} />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={visibleIds.length === 0}
          onClick={() => void act.exportSelected(visibleIds)}
          tooltip="Write the selected VISIBLE assets as .tdp files into a folder you pick — the folder structure is recreated (filter applies)"
        >
          Export
        </Button>
      </div>
    </>
  );
}
