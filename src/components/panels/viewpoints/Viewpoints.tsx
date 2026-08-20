// Viewpoints panel: capture, edit and activate named scene viewpoints
// (camera + clipping + labels + measurements + color rules + selection).
import { IconBookmark, IconCameraPlus, IconDownload, IconUpload } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, InfoBox, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { ViewpointRow } from './ViewpointRow';

/** Viewpoints: named snapshots of the whole view — camera, clipping, labels,
 *  measurements, color rules and a selection — activated with one click. */
export function Viewpoints() {
  useMinSize(300, 300);
  const s = viewpointsState.use();
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));
  return (
    <PanelBody className="panel-body flex flex-col gap-1.5 overflow-y-auto p-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          icon={<IconCameraPlus size={14} />}
          tooltip="Snapshot the current camera and clipping into a new EMPTY viewpoint and activate it — labels, measurements, rules and selection start blank (use the Copy buttons to bring content in)"
          shortcut="viewpoints.add"
          onClick={() => void act.addViewpoint()}
        >
          Add viewpoint
        </Button>
        {s.bookmarkButton && (
          <Button
            icon={<IconBookmark size={14} />}
            tooltip={s.bookmarkButton.tooltip || 'Send the current viewpoints to the hosting page as a bookmark'}
            shortcut="viewpoints.bookmark"
            onClick={() => act.bookmarkClicked()}
          >
            {s.bookmarkButton.label}
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
        {picker.element}
      </div>
      {s.list.length === 0 && (
        <InfoBox>
          No viewpoints yet — set up the camera and clipping and press Add viewpoint, then use the Copy buttons to bring
          labels, measurements and colors in.
        </InfoBox>
      )}
      {s.list.map((vp, i) => (
        <ViewpointRow
          key={vp.id}
          vp={vp}
          active={s.activeId === vp.id}
          expanded={s.selectedId === vp.id}
          idx={i}
          total={s.list.length}
        />
      ))}
    </PanelBody>
  );
}
