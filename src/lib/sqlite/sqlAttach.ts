// Work out which database files a SQL script touches, so the runner can lock
// exactly those. The main database is picked in the panel; every OTHER file
// has to arrive through `ATTACH [DATABASE] '<path>'`, and SQLite only accepts a
// string literal there — so a scan for single-quoted literals after ATTACH is
// exact, not a heuristic, as long as comments and unrelated strings are
// stripped first.

/** Replace comments with equivalent whitespace (keeps offsets sane and can't
 *  fuse two tokens together). String literals are left alone — the ATTACH scan
 *  needs them, and a `--` inside a literal must NOT start a comment. */
export function stripSqlComments(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'") {
      // literal: '' is an escaped quote, so only a lone ' ends it
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += sql.slice(start, i);
      continue;
    }
    if (c === '"' || c === '`') {
      // quoted identifier — copied through verbatim
      const q = c;
      const start = i++;
      while (i < sql.length && sql[i] !== q) {
        i++;
      }
      i = Math.min(i + 1, sql.length);
      out += sql.slice(start, i);
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const ATTACH_RE = /\bATTACH\s+(?:DATABASE\s+)?'((?:[^']|'')*)'/gi;

/** Every path in an `ATTACH [DATABASE] '…'` statement, in source order,
 *  de-duplicated. `''` inside the literal unescapes to a single quote. */
export function parseAttachPaths(sql: string): string[] {
  const clean = stripSqlComments(sql);
  const out: string[] = [];
  ATTACH_RE.lastIndex = 0;
  for (let m = ATTACH_RE.exec(clean); m; m = ATTACH_RE.exec(clean)) {
    const path = m[1].replace(/''/g, "'");
    if (path && !out.includes(path)) {
      out.push(path);
    }
  }
  return out;
}

/** Split a script into statements on top-level `;` (comments and literals are
 *  respected). Empty fragments are dropped. */
export function splitSqlStatements(sql: string): string[] {
  const clean = stripSqlComments(sql);
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "'") {
      const start = i++;
      while (i < clean.length) {
        if (clean[i] === "'" && clean[i + 1] === "'") {
          i += 2;
        } else if (clean[i] === "'") {
          break;
        } else {
          i++;
        }
      }
      buf += clean.slice(start, i + 1);
      continue;
    }
    if (c === ';') {
      if (buf.trim()) {
        parts.push(buf.trim());
      }
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) {
    parts.push(buf.trim());
  }
  return parts;
}
