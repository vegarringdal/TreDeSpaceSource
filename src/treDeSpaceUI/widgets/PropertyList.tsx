import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PropertyRow {
  /** Stable identity of the row. */
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Styled tooltip on the label cell — for a truncated or renamed key. */
  tooltip?: string;
  /** Cell before the label (a checkbox, a swatch). */
  leading?: ReactNode;
}

export interface PropertyListProps {
  rows: readonly PropertyRow[];
  /**
   * `fixed` (default) gives the label a fixed column and lets the value fill —
   * a record's fields; `fill` lets the LABEL fill and keeps the value at its
   * natural width — a description with a key cap after it.
   */
  layout?: 'fixed' | 'fill';
  /** Label column width in px when `layout` is 'fixed'. */
  labelWidth?: number;
  /** Monospace, right-aligned values — for numeric read-outs. */
  numeric?: boolean;
  /** Rule under every row (a scrolling field list). */
  divided?: boolean;
  className?: string;
}

/** A label/value read-out: the field list of a record, a stats block, a table
 *  of fixed controls. Rows are data, so the caller keeps its own components
 *  (a Kbd, a Badge, a link) in `value`. */
export function PropertyList({
  rows,
  layout = 'fixed',
  labelWidth = 128,
  numeric = false,
  divided = false,
  className = '',
}: PropertyListProps) {
  return (
    <dl className={cn('m-0 flex flex-col text-xs', className)}>
      {rows.map((r) => (
        <div key={r.key} className={cn('flex items-center gap-2 py-1', divided && 'border-slate-800 border-b px-2')}>
          {r.leading != null && <span className="flex shrink-0 items-center">{r.leading}</span>}
          <dt
            className={cn('truncate text-slate-400', layout === 'fill' ? 'min-w-0 flex-1' : 'shrink-0')}
            style={layout === 'fixed' ? { width: labelWidth } : undefined}
            data-tooltip={r.tooltip}
          >
            {r.label}
          </dt>
          <dd
            className={cn(
              'm-0 break-words text-slate-200',
              layout === 'fill' ? 'shrink-0' : 'min-w-0 flex-1',
              numeric && 'select-text text-right font-mono',
            )}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
