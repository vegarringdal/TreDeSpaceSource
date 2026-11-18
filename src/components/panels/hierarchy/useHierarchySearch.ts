import { useEffect, useState } from 'react';
import { db } from '../../../state/viewer/db';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** One search row: an import folder (`model === -1`, `group` set), a model
 *  root or a deeper entry. `count` is set in one-per-name mode: how many
 *  entries carry this name. */
export type SearchResult = Readonly<{
  model: number;
  entry: number;
  name: string;
  path: number[];
  group?: string;
  count?: number;
}>;

export type MatchMode = 'contains' | 'exact';

export type HierarchySearch = Readonly<{
  query: string;
  setQuery: (query: string) => void;
  mode: MatchMode;
  setMode: (mode: MatchMode) => void;
  /** One row per name instead of one per entry. */
  isDistinct: boolean;
  toggleDistinct: () => void;
  /** null = no search running (query too short). */
  results: SearchResult[] | null;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 200;
const MAX_RESULTS = 10;
const MIN_QUERY_LEN = 2;

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** Debounced worker-side name search (top ten, shallowest level first) with
 *  its match mode and one-per-name toggle. */
export function useHierarchySearch(): HierarchySearch {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MatchMode>('contains');
  const [isDistinct, setIsDistinct] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  const toggleDistinct = (): void => setIsDistinct((d) => !d);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LEN) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void db.search(query, mode === 'exact' ? 'equals' : 'contains', MAX_RESULTS, isDistinct).then(setResults);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, mode, isDistinct]);

  return { query, setQuery, mode, setMode, isDistinct, toggleDistinct, results };
}
