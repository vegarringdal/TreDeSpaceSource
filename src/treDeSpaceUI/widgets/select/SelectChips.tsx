import type { SelectOption } from './Select';

/** Multi-select trigger summary: one chip per selected option with remove ×. */
export function SelectChips({
  values,
  known,
  onRemove,
}: {
  values: string[];
  known: (v: string) => SelectOption;
  onRemove: (v: string) => void;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap gap-1">
      {values.map(known).map((o) => (
        <span
          key={o.value}
          className="flex items-center gap-1 border border-slate-600 bg-blue-950 py-0.5 pr-1 pl-1.5 text-blue-100 leading-none"
        >
          {o.label}
          <span
            role="button"
            aria-label={`Remove ${o.label}`}
            className="cursor-pointer px-0.5 text-slate-400 hover:text-red-400"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(o.value);
            }}
          >
            ×
          </span>
        </span>
      ))}
    </span>
  );
}
