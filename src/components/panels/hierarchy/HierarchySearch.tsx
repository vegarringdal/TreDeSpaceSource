import { IconCube, IconFolder, IconStack2 } from '@tabler/icons-react';
import {
  Badge,
  Button,
  SegmentedControl,
  type SegmentedOption,
  TextInput,
  TreeView,
  type TreeViewRow,
} from '@treDeSpaceUI/widgets';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { keyOf } from './hierarchyModel';
import { type MatchMode, type SearchResult, useHierarchySearch } from './useHierarchySearch';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The two name-match modes — the same pair the asset search offers. */
const MATCH_MODES = [
  { value: 'contains', label: '*', tooltip: 'Contains — any part of the name matches' },
  { value: 'exact', label: '=', tooltip: 'Equals — whole-string match' },
] as const satisfies readonly SegmentedOption<MatchMode>[];

const DISTINCT_TOOLTIP =
  'One row per name — a name found several times shows once (×N); clicking it selects every copy and jumps to the first';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const resultKey = (r: SearchResult): string => r.group ?? keyOf(r.model, r.entry);

/** One result row: a folder, a model root, or a deeper entry — with the copy
 *  count when one row stands for several entries of the same name. */
function toTreeRow(r: SearchResult): TreeViewRow {
  const copies = r.count ?? 1;
  return {
    key: resultKey(r),
    depth: 0,
    label: r.group ? (r.group.split('/').pop() ?? r.name) : r.name,
    icon: r.group ? (
      <IconFolder size={14} className="shrink-0 text-amber-400/80" />
    ) : (
      <IconCube size={14} className={`shrink-0 ${r.path.length === 1 ? 'text-sky-400/80' : 'text-slate-600'}`} />
    ),
    trailing: copies > 1 ? <Badge tooltip={`${copies} items share this name`}>×{copies}</Badge> : undefined,
  };
}

/** Name search over the loaded models: match mode, one-per-name toggle and
 *  the result list. A click picks a result; Ctrl/⌘ marks the pick additive. */
export function HierarchySearch({ onPick }: { onPick: (r: SearchResult, additive: boolean) => void }) {
  const search = useHierarchySearch();
  const byKey = new Map((search.results ?? []).map((r) => [resultKey(r), r]));

  // -----------------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------------

  const handleRowClick = (row: TreeViewRow, e: ReactMouseEvent): void => {
    const r = byKey.get(row.key);
    if (r) {
      onPick(r, e.ctrlKey || e.metaKey);
    }
  };

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <>
      <div className="mb-1 flex shrink-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <TextInput type="search" value={search.query} onChange={search.setQuery} placeholder="Search items…" />
        </div>
        <SegmentedControl value={search.mode} options={MATCH_MODES} onChange={search.setMode} />
        <Button
          iconOnly
          icon={<IconStack2 />}
          active={search.isDistinct}
          tooltip={DISTINCT_TOOLTIP}
          onClick={search.toggleDistinct}
        />
      </div>
      {search.results !== null && (
        <TreeView
          className="mb-1 max-h-56 shrink-0 border-slate-800 border-b pb-1"
          rows={search.results.map(toTreeRow)}
          padLeft={8}
          emptyText="No matches."
          onRowClick={handleRowClick}
        />
      )}
    </>
  );
}
