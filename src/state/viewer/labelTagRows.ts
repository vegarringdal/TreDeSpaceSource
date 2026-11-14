// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TagPoint = [number, number, number];

/** One pasted row: a name, and the point it is to stand at when the row
 *  carried coordinates (`null` = look the name up in the model). */
export type TagRow = Readonly<{
  name: string;
  at: TagPoint | null;
}>;

export type ParsedTagRows = Readonly<{
  rows: readonly TagRow[];
  /** rows that carry SOME coordinates but not a readable x, y and z */
  bad: readonly string[];
}>;

/** What a tag import could not use — written back into the paste box. */
export type TagImportLeftovers = Readonly<{
  notFound: readonly string[];
  bad: readonly string[];
}>;

/** A name the model knows, as `findLabelAnchors` answers it. */
export type TagAnchor = Readonly<{
  name: string;
  center: TagPoint;
}>;

/** The fields of a label the import decides; the caller adds id and style. */
export type TagLabelDraft = Readonly<{
  text: string;
  fullname: string | null;
  anchor: TagPoint;
}>;

type CellSplit = Readonly<{
  cells: readonly string[];
  /** digits may be grouped with spaces ("6 650 123,45") — only inside a cell
   *  that a tab or semicolon delimits, where a space cannot be a separator */
  grouped: boolean;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const NOT_FOUND_HEADER = 'Not found:';
export const BAD_ROWS_HEADER = 'Needs x, y and z:';

const HEADERS = [NOT_FOUND_HEADER, BAD_ROWS_HEADER].map((h) => h.toLowerCase());
const COORD_COUNT = 3;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const DIGIT_GROUP_GAP = /(?<=\d)[   '](?=\d)/g;
const NAME_THEN_THREE_TOKENS = /^(.*\S)\s+(\S+)\s+(\S+)\s+(\S+)$/;
const POINT_KEY_DECIMALS = 3;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Name identity: fullnames resolve case-insensitively, the leading '/' is
 *  optional on both sides. */
const nameKey = (name: string): string => name.trim().toLowerCase().replace(/^\//, '');

const pointKey = (text: string, at: TagPoint): string =>
  `${text.trim().toLowerCase()}@${at.map((v) => v.toFixed(POINT_KEY_DECIMALS)).join(',')}`;

const countOf = (text: string, char: string): number => text.split(char).length - 1;

/**
 * One coordinate as a spreadsheet writes it. Accepts a decimal point or a
 * decimal comma, and thousands separators when the other mark is the decimal
 * ("1,234.5", "1.234,5") or the mark repeats ("1,234,567"). A single comma is
 * read as the decimal mark. `grouped` also allows spaces between digit groups.
 */
export function parseCoordinate(cell: string, grouped = false): number | null {
  let t = cell.trim().replace(/^−/, '-');
  if (grouped) {
    t = t.replace(DIGIT_GROUP_GAP, '');
  }
  const commas = countOf(t, ',');
  const dots = countOf(t, '.');
  if (commas > 0 && dots > 0) {
    const decimal = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
    t = t.replaceAll(decimal === ',' ? '.' : ',', '').replace(',', '.');
  } else if (commas === 1) {
    t = t.replace(',', '.');
  } else if (commas > 1) {
    t = t.replaceAll(',', '');
  } else if (dots > 1) {
    t = t.replaceAll('.', '');
  }
  if (!PLAIN_NUMBER.test(t)) {
    return null;
  }
  const n = Number(t);

  return Number.isFinite(n) ? n : null;
}

/**
 * Split a row into name + coordinate cells. Tried in order: tabs (a
 * spreadsheet copy), semicolons, commas (only when that gives exactly a name
 * and three plain numbers — a comma may also be a decimal mark), then spaces
 * (only when the last three words are numbers, so names with spaces survive).
 * A row that is just a name comes back as one cell.
 */
function splitCells(row: string): CellSplit {
  for (const separator of ['\t', ';']) {
    if (row.includes(separator)) {
      return { cells: row.split(separator).map((c) => c.trim()), grouped: true };
    }
  }
  const byComma = row.split(',').map((c) => c.trim());
  if (byComma.length === COORD_COUNT + 1 && byComma.slice(1).every((c) => PLAIN_NUMBER.test(c))) {
    return { cells: byComma, grouped: false };
  }
  const spaced = NAME_THEN_THREE_TOKENS.exec(row);
  if (spaced?.slice(2).every((c) => parseCoordinate(c) !== null)) {
    return { cells: spaced.slice(1), grouped: false };
  }

  return { cells: [row], grouped: false };
}

/** A row's reading: a tag row, or `null` when it carries some coordinates but
 *  not all three (or coordinates without a name). */
function readRow(row: string): TagRow | null {
  const { cells, grouped } = splitCells(row);
  const name = cells[0];
  const coords = cells.slice(1, COORD_COUNT + 1).map((c) => parseCoordinate(c, grouped));
  const readable = coords.filter((c) => c !== null);
  if (readable.length === 0) {
    return name ? { name, at: null } : null;
  }
  if (readable.length < COORD_COUNT || !name) {
    return null;
  }

  return { name, at: [readable[0], readable[1], readable[2]] };
}

/**
 * Pasted rows → distinct tag rows, in paste order. A row is a name, optionally
 * followed by x, y, z in metres (see splitCells for the separators). Blank
 * rows and the headers a previous run wrote back are dropped; the same name
 * twice is one row, the same name at two different points is two.
 */
export function parseTagRows(text: string): ParsedTagRows {
  const seen = new Set<string>();
  const rows: TagRow[] = [];
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || HEADERS.some((h) => row.toLowerCase().startsWith(h))) {
      continue;
    }
    const read = readRow(row);
    if (read === null) {
      bad.push(row);
      continue;
    }
    const key = read.at ? pointKey(read.name, read.at) : read.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(read);
  }

  return { rows, bad };
}

/**
 * Turn parsed rows into the labels to add, in paste order.
 *
 * A name-only row becomes one label per model that carries the name (`found`),
 * anchored where the lookup says; a fullname that already has a label is
 * skipped. A row with coordinates is never looked up for its position: it
 * stands at its point with the pasted name as text, linked to the model's
 * fullname when `links` knows the name and unlinked otherwise. Such a row is
 * skipped only when a label with the same text already stands at that point.
 */
export function planTagLabels(
  rows: readonly TagRow[],
  found: readonly TagAnchor[],
  links: readonly TagAnchor[],
  existing: readonly TagLabelDraft[],
  stripSlash: boolean,
): TagLabelDraft[] {
  const shown = (name: string): string => (stripSlash ? name.replace(/^\//, '') : name);
  const anchors = new Map<string, TagAnchor[]>();
  for (const f of found) {
    anchors.set(nameKey(f.name), [...(anchors.get(nameKey(f.name)) ?? []), f]);
  }
  const linked = new Map<string, string>();
  for (const l of links) {
    if (!linked.has(nameKey(l.name))) {
      linked.set(nameKey(l.name), l.name);
    }
  }
  const takenNames = new Set(existing.flatMap((l) => (l.fullname === null ? [] : [l.fullname.toLowerCase()])));
  const takenPoints = new Set(existing.map((l) => pointKey(l.text, l.anchor)));
  const out: TagLabelDraft[] = [];
  for (const row of rows) {
    if (row.at) {
      const text = shown(row.name);
      const key = pointKey(text, row.at);
      if (!takenPoints.has(key)) {
        takenPoints.add(key);
        out.push({ text, fullname: linked.get(nameKey(row.name)) ?? null, anchor: row.at });
      }
      continue;
    }
    for (const f of anchors.get(nameKey(row.name)) ?? []) {
      const key = f.name.toLowerCase();
      if (!takenNames.has(key)) {
        takenNames.add(key);
        out.push({ text: shown(f.name), fullname: f.name, anchor: f.center });
      }
    }
    anchors.delete(nameKey(row.name));
  }

  return out;
}

/** The text put back into the paste box after an import: what was not found
 *  and what could not be read, each under its header. Empty = all used. */
export function formatTagLeftovers({ notFound, bad }: TagImportLeftovers): string {
  const blocks: string[] = [];
  if (notFound.length > 0) {
    blocks.push([NOT_FOUND_HEADER, ...notFound].join('\n'));
  }
  if (bad.length > 0) {
    blocks.push([BAD_ROWS_HEADER, ...bad].join('\n'));
  }

  return blocks.join('\n');
}
