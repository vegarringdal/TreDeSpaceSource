// Field rows for a SQL Detail form: one per column of the detail row, except
// that a column holding a JSON ARRAY — json_group_array(json_object(…)) in the
// query — flattens into one row per element, so several source rows
// (documents, links, tags) fold into a single attribute. Values that are
// http(s) URLs carry a link.

export type DetailField = Readonly<{
  /** Unique per row: labels may repeat, so it carries column + element index. */
  key: string;
  /** The source column (tooltip). */
  col: string;
  /** The displayed field name: the column, or a flattened element's `label`. */
  label: string;
  val: unknown;
  /** Set when `val` is an http(s) URL. */
  href?: string;
  /** Anchor text for `href`: an element's `value_link_label`, else the URL
   *  itself; a plain column shows "Open link". */
  linkLabel?: string;
}>;

const PLAIN_LINK_LABEL = 'Open link';
const LABEL_KEY = 'label';
const VALUE_KEY = 'value';
const LINK_LABEL_KEY = 'value_link_label';

function linkOf(v: unknown): string | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim();
  return /^https?:\/\//i.test(s) ? s : undefined;
}

/** A string that parses as a JSON array, else null — anything malformed stays
 *  a plain value so existing reports never change shape. */
function parseArray(v: unknown): unknown[] | null {
  if (typeof v !== 'string') {
    return null;
  }
  const s = v.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type BareField = Omit<DetailField, 'href' | 'linkLabel'>;

function withLink(f: BareField, linkLabel: string | undefined, isPlainColumn: boolean): DetailField {
  const href = linkOf(f.val);
  if (!href) {
    return f;
  }
  return { ...f, href, linkLabel: linkLabel ?? (isPlainColumn ? PLAIN_LINK_LABEL : href) };
}

/** One flattened element: an object is read by label / value /
 *  value_link_label (an object with neither label nor value shows as its
 *  JSON), a primitive is a value under the column's own name. */
function elementField(col: string, el: unknown, key: string): DetailField {
  if (!isRecord(el)) {
    return withLink({ key, col, label: col, val: el }, undefined, false);
  }
  const hasShape = LABEL_KEY in el || VALUE_KEY in el;
  const label = el[LABEL_KEY];
  const linkLabel = el[LINK_LABEL_KEY];
  return withLink(
    {
      key,
      col,
      label: label == null ? col : String(label),
      val: hasShape ? (el[VALUE_KEY] ?? null) : JSON.stringify(el),
    },
    typeof linkLabel === 'string' && linkLabel !== '' ? linkLabel : undefined,
    false,
  );
}

/** The field rows for a detail row, in SELECT order; a JSON-array column
 *  expands in place (an empty array is one null row, so Hide empty can drop
 *  it and showing empties still lists the column). */
export function buildDetailFields(columns: readonly string[], row: readonly unknown[]): DetailField[] {
  const out: DetailField[] = [];
  columns.forEach((col, i) => {
    const val = row[i];
    const arr = parseArray(val);
    if (!arr || arr.length === 0) {
      out.push(withLink({ key: `${i}:${col}`, col, label: col, val: arr ? null : val }, undefined, true));
      return;
    }
    for (const [j, el] of arr.entries()) {
      out.push(elementField(col, el, `${i}:${col}:${j}`));
    }
  });
  return out;
}

export function isEmptyValue(v: unknown): boolean {
  return v == null || v === '';
}

/** Case-insensitive match on the field name, its source column, its value
 *  and its link text. `q` must already be lower-cased and trimmed. */
export function matchesFilter(f: DetailField, q: string): boolean {
  if (!q) {
    return true;
  }
  return [f.label, f.col, String(f.val ?? ''), f.linkLabel ?? ''].some((s) => s.toLowerCase().includes(q));
}
