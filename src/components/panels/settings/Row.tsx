import type { ReactNode } from 'react';

/** One labelled fixed-width field line in a settings form. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="w-28 shrink-0">{children}</div>
    </div>
  );
}
