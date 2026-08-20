import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SelectOption } from './Select';
import type { SelectDropdown } from './useSelectDropdown';

/** The portaled listbox: optional search box, async states, option rows. */
export function SelectList({
  dd,
  multiple,
  searchable,
  hasAsync,
  selected,
  pick,
  onKeyDown,
}: {
  dd: SelectDropdown;
  multiple: boolean;
  searchable: boolean;
  hasAsync: boolean;
  selected: ReadonlySet<string>;
  pick: (opt: SelectOption) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}) {
  const { pos, asyncState, filtered, hot } = dd;

  return (
    <div
      ref={dd.popRef}
      onKeyDown={onKeyDown}
      className="fixed z-[1000] overflow-hidden border border-slate-700 bg-slate-900 text-slate-200 text-xs shadow-black/40 shadow-lg"
      style={{
        left: pos.left,
        // at least as wide as the trigger, but grow to fit the options
        minWidth: pos.width,
        width: 'max-content',
        maxWidth: `calc(100vw - ${pos.left + 8}px)`,
        top: pos.up ? undefined : pos.top + 4,
        bottom: pos.up ? window.innerHeight - pos.top + 4 : undefined,
      }}
    >
      {searchable && (
        <div className="border-slate-800 border-b p-1.5">
          <input
            ref={dd.searchRef}
            value={dd.query}
            placeholder="Search…"
            className="w-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 text-xs placeholder-slate-500 outline-none focus:border-blue-400"
            onChange={(e) => {
              dd.setQuery(e.target.value);
              dd.setHot(0);
            }}
          />
        </div>
      )}
      <div
        ref={dd.listRef}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        className="max-h-52 overflow-auto p-1"
      >
        {hasAsync && asyncState.loading && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-slate-400">
            <svg viewBox="0 0 24 24" className="h-3 w-3 animate-spin fill-none stroke-2 stroke-current">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            Searching…
          </div>
        )}
        {hasAsync && asyncState.error && !asyncState.loading && (
          <div className="px-2 py-1.5 text-red-400">{asyncState.error}</div>
        )}
        {filtered.length === 0 && !asyncState.loading && !asyncState.error && (
          <div className="px-2 py-1.5 text-slate-400">No matches</div>
        )}
        {filtered.map((opt, i) => {
          const isSel = selected.has(opt.value);
          return (
            <div
              key={opt.value}
              role="option"
              aria-selected={isSel}
              data-hot={i === hot ? '1' : undefined}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${
                opt.disabled
                  ? 'cursor-not-allowed text-slate-600'
                  : i === hot
                    ? 'bg-blue-950 text-blue-100'
                    : 'text-slate-200'
              }`}
              onPointerEnter={() => dd.setHot(i)}
              onClick={() => pick(opt)}
            >
              {multiple && (
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                    isSel ? 'border-blue-400 bg-blue-400' : 'border-slate-600'
                  }`}
                >
                  {isSel && (
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-2 stroke-slate-950">
                      <path d="M2 5l2.2 2.2L8 3" />
                    </svg>
                  )}
                </span>
              )}
              {!multiple && (
                <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                  {isSel && (
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-2 stroke-blue-400">
                      <path d="M2 5l2.2 2.2L8 3" />
                    </svg>
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              {opt.hint && <span className="shrink-0 text-slate-400">{opt.hint}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
