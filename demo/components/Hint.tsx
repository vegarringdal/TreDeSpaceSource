import type { ReactNode } from 'react';

/** Small dimmed helper text under a control. */
export function Hint({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="m-0 text-[11px] text-slate-500 leading-snug">{children}</p>;
}
