import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  z: number;
  children: ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** Shared modal shell: dimmed backdrop + centred window at the given layer. */
export function Modal({ z, children, onKeyDown }: ModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 text-slate-200"
      style={{ zIndex: z }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface TitleBarProps {
  icon: ReactNode;
  children: ReactNode;
}

export function TitleBar({ icon, children }: TitleBarProps) {
  return (
    <div className="flex items-center gap-2 border-slate-800 border-b bg-slate-800 px-3 py-2 font-semibold text-xs">
      {icon}
      {children}
    </div>
  );
}
