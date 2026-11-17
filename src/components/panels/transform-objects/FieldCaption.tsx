import type { ReactNode } from 'react';

/** A field caption on its own line, so the three numbers under it get the
 *  panel's whole width (a label column leaves too little at panel width). */
export function FieldCaption({ children }: { children: ReactNode }) {
  return <div className="mt-1 text-[11px] text-slate-400">{children}</div>;
}
