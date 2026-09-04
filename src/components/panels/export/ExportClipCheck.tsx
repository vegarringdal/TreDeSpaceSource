import { exportState } from './export.state';

/** The "Exclude clipped parts" option, shared by the TDP, GLB and IFC
 *  sections (one persisted setting): with it on, an export leaves out every
 *  item that lies entirely outside the active clipping planes, box and
 *  shapes — the parts you cannot see — and keeps anything the clip volume
 *  intersects, whole. */
export function ExportClipCheck() {
  const s = exportState.use();
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
      data-shortcut="export.excludeClipped"
      data-tooltip="Leave out parts clipped away entirely by the clipping planes, box and shapes (holes included); a part the clip volume cuts through is kept whole. Off = everything not hidden, as if clipping were disabled"
    >
      <input
        type="checkbox"
        checked={s.excludeClipped}
        onChange={(e) => exportState.set({ excludeClipped: e.target.checked })}
      />
      Exclude clipped parts
    </label>
  );
}
