import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SelectChips } from './SelectChips';
import { SelectList } from './SelectList';
import { useSelectDropdown } from './useSelectDropdown';

export interface SelectOption {
  value: string;
  label: string;
  /** Dimmed text after the label — a unit, a path, a shortcut. */
  hint?: string;
  disabled?: boolean;
}

interface BaseProps {
  options?: SelectOption[];
  placeholder?: string;
  /** Show a filter box at the top of the list. Implied by loadOptions. */
  searchable?: boolean;
  /**
   * Async search: called (debounced) with the current query; resolve with the
   * matching options or throw/reject to show the error in the list. Replaces
   * local filtering of `options`.
   */
  loadOptions?: (query: string) => Promise<SelectOption[]>;
  disabled?: boolean;
  className?: string;
}

export interface SingleSelectProps extends BaseProps {
  multiple?: false;
  value: string | null;
  /** Receives null when the user clears the selection. */
  onChange: (value: string | null) => void;
}

export interface MultiSelectProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

export type SelectProps = SingleSelectProps | MultiSelectProps;

/**
 * A dropdown in the dock's visual language. Single or multi select, optional
 * search, full keyboard support (arrows / Enter / Escape / type-to-filter).
 * Multi-select keeps the list open and shows checkmarks; the trigger sums up.
 */
export function Select(props: SelectProps) {
  const { options = [], placeholder = 'Select…', loadOptions, disabled = false, className = '' } = props;
  const searchable = props.searchable || loadOptions != null;

  const selected = useMemo(
    () => new Set(props.multiple ? props.value : props.value != null ? [props.value] : []),
    [props.multiple, props.value],
  );
  const dd = useSelectDropdown(options, loadOptions, searchable, selected);

  const pick = (opt: SelectOption) => {
    if (opt.disabled) {
      return;
    }
    if (props.multiple) {
      const next = new Set(props.value);
      next.has(opt.value) ? next.delete(opt.value) : next.add(opt.value);
      props.onChange([...next]);
    } else {
      props.onChange(opt.value);
      dd.setOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!dd.open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      dd.setOpen(true);
      return;
    }
    if (!dd.open) {
      return;
    }
    if (e.key === 'Escape') {
      dd.setOpen(false);
    } else if (e.key === 'ArrowDown') {
      dd.setHot((h) => Math.min(h + 1, dd.filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      dd.setHot((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && dd.filtered[dd.hot]) {
      pick(dd.filtered[dd.hot]);
    } else {
      return;
    }
    e.preventDefault();
  };

  const summary = props.multiple ? (
    props.value.length === 0 ? null : (
      <SelectChips
        values={props.value}
        known={dd.known}
        onRemove={(v) => props.onChange(props.value.filter((x) => x !== v))}
      />
    )
  ) : props.value != null ? (
    dd.known(props.value).label
  ) : null;

  return (
    <div ref={dd.rootRef} className={`relative text-xs ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={dd.open}
        className={`group flex min-h-6 w-full cursor-pointer items-center gap-1.5 border px-2 py-0.5 text-left ${
          dd.open ? 'border-blue-400 bg-slate-900' : 'border-slate-700 bg-slate-900 hover:border-slate-600'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''} text-slate-200`}
        onClick={() => dd.setOpen((o) => !o)}
      >
        {summary == null ? (
          <span className="min-w-0 flex-1 truncate text-slate-400">{placeholder}</span>
        ) : props.multiple ? (
          summary
        ) : (
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        )}
        {summary != null && !disabled && (
          <span
            role="button"
            aria-label="Clear selection"
            title="Clear"
            className="shrink-0 cursor-pointer px-0.5 text-slate-400 leading-none opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (props.multiple) {
                props.onChange([]);
              } else {
                props.onChange(null);
              }
            }}
          >
            ×
          </span>
        )}
        <svg
          viewBox="0 0 8 8"
          className={`h-2 w-2 shrink-0 fill-slate-500 transition-transform ${dd.open ? 'rotate-180' : ''}`}
        >
          <path d="M0 2l4 4 4-4z" />
        </svg>
      </button>

      {dd.open &&
        createPortal(
          <SelectList
            dd={dd}
            multiple={props.multiple === true}
            searchable={searchable}
            hasAsync={loadOptions != null}
            selected={selected}
            pick={pick}
            onKeyDown={onKeyDown}
          />,
          document.body,
        )}
    </div>
  );
}
