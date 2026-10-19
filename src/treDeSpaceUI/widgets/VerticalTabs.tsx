import { type ReactNode, useState } from 'react';

export interface VerticalTab {
  /** Tab id — what `value` / `onChange` use. */
  id: string;
  /** Omit for an icon-only tab — pair it with `tooltip`. */
  label?: string;
  /** Leading icon (16×16); the strip becomes an icon rail when no tab has a label. */
  icon?: ReactNode;
  /** Styled tooltip (data-tooltip); supports "\n" for multiple lines. */
  tooltip?: string;
  /** The tab's page — mounted only while the tab is active. */
  content: ReactNode;
}

export interface VerticalTabsProps {
  /** Tabs in strip order; only the active one's `content` is mounted. */
  tabs: VerticalTab[];
  /** Controlled active tab — pair with onChange. */
  value?: string;
  /** Uncontrolled initial tab (default: the first). */
  defaultValue?: string;
  /** A tab was clicked. */
  onChange?: (id: string) => void;
  /** Which side the strip sits on (default left). */
  side?: 'left' | 'right';
  className?: string;
}

/** A tab strip that runs down the side instead of across the top. */
export function VerticalTabs({
  tabs,
  value,
  defaultValue,
  onChange,
  side = 'left',
  className = '',
}: VerticalTabsProps) {
  const [own, setOwn] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? own;
  const select = (id: string) => {
    onChange?.(id);
    if (value == null) {
      setOwn(id);
    }
  };

  // Every tab label-less → a narrow icon rail (give those tabs tooltips).
  const iconOnly = tabs.every((t) => t.label == null);

  const strip = (
    <div
      role="tablist"
      aria-orientation="vertical"
      className={`flex ${iconOnly ? 'w-9' : 'w-24'} min-h-0 shrink-0 flex-col gap-0.5 overflow-y-auto bg-slate-900 p-1`}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={t.label ?? t.tooltip?.split('\n')[0]}
            data-tooltip={t.tooltip}
            className={`flex cursor-pointer items-center gap-1.5 border-0 px-2 py-1 text-left text-[11px] ${
              t.label == null ? 'justify-center px-0' : ''
            } ${
              isActive
                ? `bg-blue-950 text-blue-100 ${side === 'left' ? 'shadow-[inset_2px_0_0_var(--color-blue-400)]' : 'shadow-[inset_-2px_0_0_var(--color-blue-400)]'}`
                : 'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            onClick={() => select(t.id)}
          >
            {t.icon && <span className="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">{t.icon}</span>}
            {t.label != null && <span className="truncate">{t.label}</span>}
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div className="min-w-0 flex-1 overflow-auto p-2.5 pl-0">{tabs.find((t) => t.id === active)?.content}</div>
  );

  return (
    <div className={`flex overflow-hidden bg-slate-950 ${className}`}>
      {side === 'left' ? strip : body}
      {side === 'left' ? body : strip}
    </div>
  );
}
