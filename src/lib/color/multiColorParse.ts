// A Multi-mode Set Color filter is a newline list of fullnames. It may ALSO
// carry a per-line color in a trailing token (separated by space, TAB or
// comma) — `/PC500-ORA yellow`, `part #ff0000`, `part,red`. The color may
// have a `:opacity` suffix (0-100): `yellow` / `yellow:` / `yellow:100` = full
// opacity, `yellow:10` = 10%. `default` restores the item's original color.
// This is what lets one Multi rule carry per-row colors + opacity, and what a
// COLORING report's result feeds in.
import { parseColor } from './hexColor';

export interface ParsedMulti {
  /** The plain newline fullname list (first columns only) — what the worker
   *  matches against. Unchanged from a single-column paste. */
  names: string;
  /** fullnameLower → packed RGBA8 (or the COLOR_DEFAULT sentinel). */
  perName: Record<string, number>;
  /** fullnameLower → opacity 0-99 (only when the line asked for < 100). */
  perOpacity: Record<string, number>;
}

/** Split a Multi filter value into its match list, per-line colors and per-line
 *  opacities. */
export function parseMultiColumn(value: string): ParsedMulti {
  const names: string[] = [];
  const perName: Record<string, number> = {};
  const perOpacity: Record<string, number> = {};
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    let name = line;
    // a trailing token after a separator that resolves to a color = the color
    const m = line.match(/^(.*?)[\t, ]+([^\t, ]+)$/);
    if (m) {
      const token = m[2];
      const head = m[1].trim();
      // colour[:opacity] — hex/name never contain ':', so the split is safe
      const ci = token.indexOf(':');
      const colorPart = ci === -1 ? token : token.slice(0, ci);
      const opPart = ci === -1 ? '' : token.slice(ci + 1);
      const c = parseColor(colorPart);
      if (c != null && head) {
        name = head;
        const key = name.toLowerCase();
        perName[key] = c;
        const op = opPart.trim() === '' ? 100 : Number(opPart);
        if (Number.isFinite(op) && op < 100) {
          perOpacity[key] = Math.max(0, Math.round(op));
        }
      }
    }
    names.push(name);
  }
  return { names: names.join('\n'), perName, perOpacity };
}
