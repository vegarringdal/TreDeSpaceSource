import { IconCube, IconFolder } from '@tabler/icons-react';
import { SegmentedControl, TextInput, TreeView, type TreeViewRow } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { db } from '../../../state/viewer/db';
import { keyOf } from './hierarchyModel';

export type SearchResult = { model: number; entry: number; name: string; path: number[]; group?: string };

const SEARCH_DEBOUNCE_MS = 200;
const MAX_RESULTS = 10;
const MIN_QUERY_LEN = 2;

/** The two name-match modes — the same pair the asset search offers. */
const MATCH_MODES = [
  { value: 'contains', label: '*', tooltip: 'Contains — any part of the name matches' },
  { value: 'exact', label: '=', tooltip: 'Equals — whole-string match' },
] as const;

type MatchMode = (typeof MATCH_MODES)[number]['value'];

/** One result row: a folder, a model root, or a deeper entry. */
function toTreeRow(r: SearchResult): TreeViewRow {
  return {
    key: r.group ?? keyOf(r.model, r.entry),
    depth: 0,
    label: r.group ? (r.group.split('/').pop() ?? r.name) : r.name,
    icon: r.group ? (
      <IconFolder size={14} className="shrink-0 text-amber-400/80" />
    ) : (
      <IconCube size={14} className={`shrink-0 ${r.path.length === 1 ? 'text-sky-400/80' : 'text-slate-600'}`} />
    ),
  };
}

/** Debounced worker-side name search (top-10, shallowest level first) with its
 *  match-mode toggle and result list. */
export function HierarchySearch({ onPick }: { onPick: (r: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MatchMode>('contains');
  const [results, setResults] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LEN) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void db.search(query, mode === 'exact' ? 'equals' : 'contains', MAX_RESULTS).then(setResults);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, mode]);

  const byKey = new Map((results ?? []).map((r) => [r.group ?? keyOf(r.model, r.entry), r]));

  return (
    <>
      <div className="mb-1 flex shrink-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <TextInput type="search" value={query} onChange={setQuery} placeholder="Search items…" />
        </div>
        <SegmentedControl value={mode} options={MATCH_MODES} onChange={setMode} />
      </div>
      {results !== null && (
        <TreeView
          className="mb-1 max-h-56 shrink-0 border-slate-800 border-b pb-1"
          rows={results.map(toTreeRow)}
          padLeft={8}
          emptyText="No matches."
          onRowClick={(t) => {
            const r = byKey.get(t.key);
            if (r) {
              onPick(r);
            }
          }}
        />
      )}
    </>
  );
}
