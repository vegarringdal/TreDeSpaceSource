import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { type PopoverPos, usePopoverAnchor } from '../usePopoverAnchor';
import type { SelectOption } from './Select';

export type SelectDropdown = Readonly<{
  open: boolean;
  setOpen: (o: boolean | ((o: boolean) => boolean)) => void;
  query: string;
  setQuery: (q: string) => void;
  hot: number;
  setHot: (h: number | ((h: number) => number)) => void;
  filtered: SelectOption[];
  asyncState: { options: SelectOption[]; loading: boolean; error: string | null };
  pos: PopoverPos;
  rootRef: RefObject<HTMLDivElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  known: (v: string) => SelectOption;
}>;

/** Open/filter/anchor state for the Select popover: debounced async search,
 *  local filtering, outside-close, and viewport-anchored placement (the
 *  anchoring itself lives in the shared usePopoverAnchor). */
export function useSelectDropdown(
  options: SelectOption[],
  loadOptions: ((query: string) => Promise<SelectOption[]>) | undefined,
  searchable: boolean,
  selected: ReadonlySet<string>,
): SelectDropdown {
  const anchor = usePopoverAnchor(Math.min(52 * 4 + (searchable ? 40 : 0) + 10, 260));
  const { open, setOpen } = anchor;
  const [query, setQuery] = useState('');
  const [hot, setHot] = useState(0); // index into `filtered`
  const [asyncState, setAsyncState] = useState<{ options: SelectOption[]; loading: boolean; error: string | null }>({
    options: [],
    loading: false,
    error: null,
  });
  const seq = useRef(0); // discards stale async responses
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Chips and the summary need labels for values whose options are no longer
  // in the (async) result list — remember every option we have ever seen.
  const labels = useRef(new Map<string, SelectOption>());
  for (const o of [...options, ...asyncState.options]) {
    labels.current.set(o.value, o);
  }
  const known = (v: string): SelectOption => labels.current.get(v) ?? { value: v, label: v };

  const filtered = useMemo(() => {
    if (loadOptions) {
      return asyncState.options;
    }
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query, loadOptions, asyncState.options]);

  // Async search: debounce the query, keep only the newest response.
  useEffect(() => {
    if (!open || !loadOptions) {
      return;
    }
    const id = ++seq.current;
    setAsyncState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      loadOptions(query.trim()).then(
        (opts) => id === seq.current && setAsyncState({ options: opts, loading: false, error: null }),
        (err) =>
          id === seq.current &&
          setAsyncState({ options: [], loading: false, error: err instanceof Error ? err.message : String(err) }),
      );
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, loadOptions]);

  useEffect(() => setHot(0), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    const first = options.findIndex((o) => selected.has(o.value));
    setHot(Math.max(0, first));
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options.findIndex, selected.has]);

  useEffect(() => {
    listRef.current?.querySelector('[data-hot="1"]')?.scrollIntoView({ block: 'nearest' });
  }, []);

  return {
    open,
    setOpen,
    query,
    setQuery,
    hot,
    setHot,
    filtered,
    asyncState,
    pos: anchor.pos,
    rootRef: anchor.rootRef,
    popRef: anchor.popRef,
    searchRef,
    listRef,
    known,
  };
}
