import { IconAsterisk, IconCube, IconEqual, IconFolder, IconX } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { db } from '../../../state/viewer/db';
import { keyOf } from './hierarchyModel';

export type SearchResult = { model: number; entry: number; name: string; path: number[]; group?: string };

/** Debounced worker-side name search (top-10, shallowest level first) with its
 *  match-mode toggle and result list. */
export function HierarchySearch({ onPick }: { onPick: (r: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [exact, setExact] = useState(false); // = exact match, * contains
  const [results, setResults] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void db.search(query, exact ? 'equals' : 'contains', 10).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query, exact]);

  return (
    <>
      <div className="mb-1 flex shrink-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={query}
            placeholder="Search items…"
            className="h-6 w-full border border-slate-700 bg-slate-900 px-2 py-0 pr-6 text-slate-200 text-xs outline-none focus:border-blue-400"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              data-tooltip="Clear search"
              className="absolute top-1/2 right-1 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              onClick={() => setQuery('')}
            >
              <IconX size={12} />
            </button>
          )}
        </div>
        <Button
          iconOnly
          active={exact}
          icon={exact ? <IconEqual /> : <IconAsterisk />}
          tooltip={exact ? 'Exact match (=)\nclick for contains (*)' : 'Contains (*)\nclick for exact match (=)'}
          onClick={() => setExact((x) => !x)}
        />
      </div>
      {results !== null && (
        <ul className="tree scroll-slim mb-1 max-h-56 shrink-0 border-slate-800 border-b pb-1">
          {results.length === 0 && <p className="note">No matches.</p>}
          {results.map((r) => (
            <li key={r.group ?? keyOf(r.model, r.entry)}>
              <button type="button" className="tree-row flex w-full min-w-0 items-center" onClick={() => onPick(r)}>
                {r.group ? (
                  <IconFolder size={14} className="mr-1 shrink-0 text-amber-400/80" />
                ) : r.path.length === 1 ? (
                  <IconCube size={14} className="mr-1 shrink-0 text-sky-400/80" />
                ) : (
                  <IconCube size={14} className="mr-1 shrink-0 text-slate-600" />
                )}
                <span className="min-w-0 truncate">{r.group ? (r.group.split('/').pop() ?? r.name) : r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
