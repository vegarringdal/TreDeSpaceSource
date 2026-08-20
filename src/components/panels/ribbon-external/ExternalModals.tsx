// Modal external dialogs: centered overlays hosting an external app iframe
// (Settings → External → "Modal dialog"). Deliberately NOT DockManager
// windows — a modal blocks the app behind it. Overlay z starts at 900, well
// BELOW the app's own dialogs (loading/error/confirm live at z 2000+), so
// those are never blocked by an external modal.
import { ExternalModalBox } from './ExternalModalBox';
import { externalModalsState } from './externalModals.state';

/** Renders every open external modal dialog as a stacked centered overlay. */
export function ExternalModals() {
  const { open } = externalModalsState.use();
  return (
    <>
      {open.map((m, i) => (
        <div
          key={m.key}
          className="fixed inset-0 flex items-center justify-center bg-black/40"
          style={{ zIndex: 900 + i }}
        >
          <ExternalModalBox m={m} />
        </div>
      ))}
    </>
  );
}
