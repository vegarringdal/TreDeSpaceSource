import { Children, isValidElement, type ReactNode } from 'react';
import { RIBBON_ROWS, type RibbonSize } from './ribbonSizes';

export { RibbonButton, type RibbonButtonProps } from './RibbonButton';
export { RibbonNumber, type RibbonNumberProps } from './RibbonNumber';
export { RibbonSlot } from './RibbonSlot';
export type { RibbonSize } from './ribbonSizes';

/** The bar itself: a full-height row of sections with dividers between them. */
export function Ribbon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-w-0 items-stretch overflow-x-auto bg-slate-900 px-1 py-1 ${className}`}>
      {children}
    </div>
  );
}

/**
 * A titled group: the item area on top, a full-width title bar underneath.
 * Children declare a `size` (big = 1 per column, medium = 2, mini = 3); the
 * section packs them into equal-width columns in order, and a column that is
 * not completely full centres its content vertically.
 */
export function RibbonSection({
  title,
  children,
  className = '',
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const columns: ReactNode[][] = [];
  let column: ReactNode[] = [];
  let used = 0;
  for (const child of Children.toArray(children)) {
    const size: RibbonSize = (isValidElement(child) && (child.props as { size?: RibbonSize }).size) || 'big';
    if (used + RIBBON_ROWS[size] > 6) {
      columns.push(column);
      column = [];
      used = 0;
    }
    column.push(child);
    used += RIBBON_ROWS[size];
  }
  if (column.length) {
    columns.push(column);
  }

  return (
    <div
      className={`grid shrink-0 grid-rows-[1fr_auto] gap-y-1 border-slate-800 border-r px-1.5 last:border-r-0 ${className}`}
    >
      <div className="grid min-h-0 auto-cols-max grid-flow-col gap-x-0.5">
        {columns.map((col, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: column order is the identity
          <div key={i} className="flex min-h-0 flex-col justify-center gap-[2px]">
            {col}
          </div>
        ))}
      </div>
      <div className="w-full px-3 py-0.5 text-center text-slate-400 text-xs leading-tight">{title}</div>
    </div>
  );
}
