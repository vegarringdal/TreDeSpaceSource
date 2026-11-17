import { TitleBar } from '@treDeSpaceUI/widgets';
import { closeExternalModal, type OpenModal } from './externalModals.state';
import { useModalDragResize } from './useModalDragResize';

/** One external modal dialog: title bar (drag to move), hosted app iframe and
 *  a bottom-right resize handle. */
export function ExternalModalBox({ m }: { m: OpenModal }) {
  const { pos, size, boxRef, handleBarDown, handleResizeDown } = useModalDragResize({
    width: m.width,
    height: m.height,
  });

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
      {/* the whole bar drags (the handler ignores presses on its buttons), so
          the wrapper — not the title text — owns the pointer capture */}
      <div className="cursor-move touch-none select-none" onPointerDown={handleBarDown}>
        <TitleBar icon={null} className="py-1.5 text-slate-200" onClose={() => closeExternalModal(m.key)}>
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
        </TitleBar>
      </div>
      <iframe
        title={m.name}
        src={m.url}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox={m.policy.sandbox}
        allow={m.policy.allow}
      />
      {/* corner resize handle — above the iframe, pointer-captured so the drag
          keeps working once the cursor moves over the iframe */}
      <div
        className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-se-resize touch-none"
        style={{ background: 'linear-gradient(135deg, transparent 50%, #64748b 50%)' }}
        onPointerDown={handleResizeDown}
      />
    </div>
  );
}
