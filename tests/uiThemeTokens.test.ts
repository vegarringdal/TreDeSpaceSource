// The @treDeSpaceUI guide (src/treDeSpaceUI/README.md, §9) lists every colour
// token the library uses and says which ones the light theme remaps. Both
// halves must match the code: the token list against the classes and
// var(--color-*) reads in the library's source, the "flips" column against the
// [data-theme="light"] block of styles.css. A token added to a widget therefore
// fails here until the guide lists it — and its light-theme behaviour has been
// decided — so the guide that ships with the npm package cannot drift.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Inventory = Readonly<{ flips: ReadonlySet<string>; same: ReadonlySet<string> }>;

const root = fileURLToPath(new URL('..', import.meta.url));
const LIB_DIR = resolve(root, 'src/treDeSpaceUI');
const GUIDE = join(LIB_DIR, 'README.md');
const STYLES = join(LIB_DIR, 'styles.css');
const TABLE_START = '<!-- theme-tokens:start -->';
const TABLE_END = '<!-- theme-tokens:end -->';
const SOURCE_FILE = /\.(tsx?|css)$/;
const FAMILIES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// a utility (`bg-slate-900`, `hover:border-l-amber-500`) or a CSS read (`var(--color-blue-400)`)
const TOKEN_USE = new RegExp(`[a-z(]-(?:-color-)?(${FAMILIES})-(\\d{2,3})\\b`, 'g');
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;
const TOKEN_DEFINITION = /^\s*--color-[a-z]+-\d+\s*:.*$/gm;

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSources(path);
    }

    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

/** Tokens the library reads. Comments are stripped (they name tokens as
 *  examples) and so are the `--color-*:` definitions in styles.css — a value
 *  the stylesheet provides is not a use. */
function usedTokens(): Set<string> {
  const used = new Set<string>();
  for (const file of listSources(LIB_DIR)) {
    const code = readFileSync(file, 'utf8')
      .replace(BLOCK_COMMENT, '')
      .replace(LINE_COMMENT, '$1')
      .replace(TOKEN_DEFINITION, '');
    for (const match of code.matchAll(TOKEN_USE)) {
      used.add(`${match[1]}-${match[2]}`);
    }
  }

  return used;
}

function lightRemapped(): Set<string> {
  const css = readFileSync(STYLES, 'utf8');
  const start = css.indexOf('[data-theme="light"]');
  const block = css.slice(start, css.indexOf('\n}', start));

  return new Set([...block.matchAll(/--color-([a-z]+-\d+)\s*:/g)].map((m) => m[1]));
}

/** The guide's table: `| \`family\` | flips | same |`, shades separated by
 *  spaces, `—` for none. */
function guideInventory(): Inventory {
  const md = readFileSync(GUIDE, 'utf8');
  const start = md.indexOf(TABLE_START);
  const end = md.indexOf(TABLE_END);
  if (start < 0 || end < start) {
    throw new Error(`README.md has no ${TABLE_START} … ${TABLE_END} block`);
  }

  const flips = new Set<string>();
  const same = new Set<string>();
  for (const line of md.slice(start, end).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const family = cells[1]?.match(/^`([a-z]+)`$/)?.[1];
    if (!family) {
      continue;
    }

    for (const [cell, into] of [
      [cells[2], flips],
      [cells[3], same],
    ] as const) {
      for (const shade of cell?.match(/\d+/g) ?? []) {
        into.add(`${family}-${shade}`);
      }
    }
  }

  return { flips, same };
}

const sorted = (tokens: Iterable<string>): string[] => [...tokens].sort();

describe('@treDeSpaceUI theme tokens', () => {
  const used = usedTokens();
  const remapped = lightRemapped();
  const { flips, same } = guideInventory();

  it('the guide lists exactly the tokens the library uses', () => {
    expect(
      sorted([...flips, ...same]),
      'update the theme-token table in src/treDeSpaceUI/README.md (§9) to the tokens the library uses',
    ).toEqual(sorted(used));
  });

  it('no token is in both columns', () => {
    expect(sorted([...flips].filter((t) => same.has(t)))).toEqual([]);
  });

  it('"flips in light" is exactly what styles.css remaps', () => {
    const misfiled = sorted(used).filter((t) => flips.has(t) !== remapped.has(t));
    expect(
      misfiled,
      'each token here is in the wrong column of the README table, or needs (or must lose) a light value in styles.css',
    ).toEqual([]);
  });
});
