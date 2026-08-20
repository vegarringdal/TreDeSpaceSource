import { closeExternalModal, type OpenModal } from './externalModals.state';
import { useModalDragResize } from './useModalDragResize';

/** One external modal dialog: title bar (drag to move), hosted app iframe and
 *  a bottom-right resize handle. */
export function ExternalModalBox({ m }: { m: OpenModal }) {
  const { pos, size, boxRef, handleBarDown, handleBarMove, handleResizeDown, handleResizeMove, clearDrag } =
    useModalDragResize({ width: m.width, height: m.height });

  return (
    <div
      ref={boxRef}
      data-ext-modal={m.key}
      className="relative flex flex-col overflow-hidden border border-slate-700 bg-slate-900 shadow-2xl"
      style={{
        width: size.w,
        height: size.h,
        maxWidth: '96vw',
        maxHeight: '96vh',
        ...(pos ? { position: 'fixed', left: pos.x, top: pos.y } : null),
      }}
    >
      <div
        className="flex cursor-move touch-none select-none items-center gap-2 border-slate-800 border-b bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 text-xs"
        onPointerDown={handleBarDown}
        onPointerMove={handleBarMove}
        onPointerUp={clearDrag}
        onPointerCancel={clearDrag}
      >
        <span className="truncate">{m.name}</span>
        <button
          type="button"
          className="ml-auto cursor-pointer px-2 text-slate-400 hover:text-white"
          data-tooltip="Close dialog"
          onClick={() => closeExternalModal(m.key)}
        >
          ✕
        </button>
      </div>
      <iframe
        title={m.name}
        src={m.url}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      />
      {/* corner resize handle — above the iframe, pointer-captured so the drag
          keeps working once the cursor moves over the iframe */}
      <div
        className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-se-resize touch-none"
        style={{ background: 'linear-gradient(135deg, transparent 50%, #64748b 50%)' }}
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={clearDrag}
        onPointerCancel={clearDrag}
      />
    </div>
  );
}
