import { Checkbox } from '@treDeSpaceUI/widgets';
import { exportState } from './export.state';

/** The "Exclude clipped parts" option, shared by the TDP, GLB and IFC
 *  sections (one persisted setting): with it on, an export leaves out every
 *  item that lies entirely outside the active clipping planes, box and
 *  shapes — the parts you cannot see — and keeps anything the clip volume
 *  intersects, whole. */
export function ExportClipCheck() {
  const s = exportState.use();
  return (
    <Checkbox
      label="Exclude clipped parts"
      checked={s.excludeClipped}
      onChange={(excludeClipped) => exportState.set({ excludeClipped })}
      shortcut="export.excludeClipped"
      tooltip="Leave out parts clipped away entirely by the clipping planes, box and shapes (holes included); a part the clip volume cuts through is kept whole. Off = everything not hidden, as if clipping were disabled"
    />
  );
}
