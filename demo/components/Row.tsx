import type { ReactNode } from 'react';

/** A wrapping toolbar row — buttons and fields with consistent gaps. */
export function Row({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}
