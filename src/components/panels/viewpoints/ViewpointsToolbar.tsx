import { IconBookmark, IconCameraPlus, IconDownload, IconTrash, IconUpload } from '@tabler/icons-react';
import { Button, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import type { ViewpointsState } from '../../../state/viewer/viewpoints.state';

type ViewpointsToolbarProps = Readonly<{
  hasViewpoints: boolean;
  /** the host page's bookmark button, when it asked for one */
  bookmarkButton: ViewpointsState['bookmarkButton'];
}>;

/** The Viewpoint Editor's button row — add, bookmark (host pages only),
 *  save / load and delete all. It stays above the list while that scrolls. */
export function ViewpointsToolbar({ hasViewpoints, bookmarkButton }: ViewpointsToolbarProps) {
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));

  return (
    <div className="flex shrink-0 flex-wrap gap-1.5">
      <Button
        icon={<IconCameraPlus size={14} />}
        tooltip="Snapshot the current camera and clipping into a new EMPTY viewpoint and activate it — labels, measurements, rules and selection start blank (use the Copy buttons to bring content in)"
        shortcut="viewpoints.add"
        onClick={() => void act.addViewpoint()}
      >
        Add viewpoint
      </Button>
      {bookmarkButton && (
        <Button
          icon={<IconBookmark size={14} />}
          tooltip={bookmarkButton.tooltip || 'Send the current viewpoints to the hosting page as a bookmark'}
          shortcut="viewpoints.bookmark"
          onClick={() => act.bookmarkClicked()}
        >
          {bookmarkButton.label}
        </Button>
      )}
      <Button
        icon={<IconDownload size={14} />}
        tooltip="Save every viewpoint to a JSON file"
        shortcut="viewpoints.save"
        onClick={() => act.saveToFile()}
      >
        Save
      </Button>
      <Button
        icon={<IconUpload size={14} />}
        tooltip="Load viewpoints from a JSON file (replaces the current set)"
        shortcut="viewpoints.load"
        onClick={picker.open}
      >
        Load
      </Button>
      <Button
        icon={<IconTrash size={14} />}
        disabled={!hasViewpoints}
        tooltip="Delete every viewpoint — a live viewpoint's content goes back to the scene first"
        shortcut="viewpoints.deleteAll"
        onClick={() => void act.removeAll()}
      >
        Delete all
      </Button>
      {picker.element}
    </div>
  );
}
