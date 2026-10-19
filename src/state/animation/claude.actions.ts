// The Timeline's Export ▾ and the ribbon's Brief for AI (DESIGN.md ›
// Animation › Files and host API): the brief Claude Code writes an animation
// file from (what to ask, the format, patterns, the user's cards and a
// schema), and the item list — the selected nodes, their children or every
// leaf under them — with the SQL result's columns joined on when it has a
// fullname column.

import { toast } from '@treDeSpaceUI/widgets';
import { getTablePayload } from '../../components/panels/sql-table/sqlTablePanel';
import {
  animationBrief,
  type BriefCard,
  type BriefItem,
  type ItemAttributes,
  itemsCsv,
} from '../../lib/animation/brief';
import { overlayLibraryState } from '../overlayComponents/overlayComponents.state';
import { db } from '../viewer/db';
import { animationDocState } from './animationDoc.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Column names the SQL result's join key may have. */
const FULLNAME_COLUMNS = new Set(['fullname', 'full_name', 'fullpath']);
const BRIEF_NAME = 'animation-brief.md';
const ITEMS_NAME = 'animation-items.csv';
const REVOKE_MS = 10_000;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

/** The file's and the library's designs (each id once). */
function knownCards(): BriefCard[] {
  const seen = new Set<string>();
  return [...animationDocState.get().doc.overlayComponents, ...overlayLibraryState.get().components]
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      params: c.params.map((p) => ({ key: p.key, label: p.label, type: p.type, default: p.default })),
    }));
}

/** The SQL table's result for the item list, when one of its columns is a
 *  fullname (its other columns are joined onto the items). */
function sqlAttributes(): ItemAttributes | undefined {
  const table = getTablePayload();
  const key = table ? table.columns.findIndex((c) => FULLNAME_COLUMNS.has(c.toLowerCase())) : -1;
  return table && key >= 0 ? { columns: table.columns, rows: table.rows, key } : undefined;
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const claudeActions = {
  /** Download the brief for Claude Code. */
  brief(): void {
    const text = animationBrief({
      cards: knownCards(),
      themes: overlayLibraryState.get().themes.map((t) => ({ id: t.id, name: t.name })),
    });
    download(text, BRIEF_NAME, 'text/markdown');
  },

  /** Download the item list for Claude: the selected nodes, their children or
   *  every leaf under them — name, fullname, tree place, centre and size. */
  async itemList(mode: 'nodes' | 'children' | 'leaves'): Promise<void> {
    const items: BriefItem[] = await db.animSelectionParts(mode);
    if (items.length === 0) {
      toast.info('Select the items in the Hierarchy or 3D view first.');
      return;
    }
    const attributes = sqlAttributes();
    download(itemsCsv(items, attributes), ITEMS_NAME, 'text/csv');
    toast.success(
      `Item list saved: ${items.length} item(s)${attributes ? `, with ${attributes.columns.length - 1} column(s) from the SQL result` : ''}.`,
    );
  },
};
