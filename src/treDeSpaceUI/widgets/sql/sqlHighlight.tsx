// The editor's two layers must use the SAME font metrics and padding or the
// caret drifts — hence this shared class.
export const EDITOR_TEXT = 'font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-words';

// SQLite keywords worth colouring — the common surface, not the full grammar.
const KEYWORDS =
  'ABORT|ACTION|ADD|AFTER|ALL|ALTER|ANALYZE|AND|AS|ASC|ATTACH|AUTOINCREMENT|BEFORE|BEGIN|BETWEEN|BY|CASCADE|CASE|CAST|CHECK|COLLATE|COLUMN|COMMIT|CONFLICT|CONSTRAINT|CREATE|CROSS|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|DATABASE|DEFAULT|DEFERRABLE|DEFERRED|DELETE|DESC|DETACH|DISTINCT|DROP|EACH|ELSE|END|ESCAPE|EXCEPT|EXCLUSIVE|EXISTS|EXPLAIN|FAIL|FOR|FOREIGN|FROM|FULL|GLOB|GROUP|HAVING|IF|IGNORE|IMMEDIATE|IN|INDEX|INDEXED|INITIALLY|INNER|INSERT|INSTEAD|INTERSECT|INTO|IS|ISNULL|JOIN|KEY|LEFT|LIKE|LIMIT|MATCH|NATURAL|NO|NOT|NOTNULL|NULL|OF|OFFSET|ON|OR|ORDER|OUTER|PLAN|PRAGMA|PRIMARY|QUERY|RAISE|RECURSIVE|REFERENCES|REGEXP|REINDEX|RELEASE|RENAME|REPLACE|RESTRICT|RIGHT|ROLLBACK|ROW|SAVEPOINT|SELECT|SET|TABLE|TEMP|TEMPORARY|THEN|TO|TRANSACTION|TRIGGER|UNION|UNIQUE|UPDATE|USING|VACUUM|VALUES|VIEW|VIRTUAL|WHEN|WHERE|WITH|WITHOUT';

// one pass, alternatives ordered so comments/strings win over keywords
const TOKENS = new RegExp(
  ['(--[^\\n]*|/\\*[\\s\\S]*?\\*/)', "('(?:[^']|'')*')", `\\b(?:${KEYWORDS})\\b`, '\\b\\d+(?:\\.\\d+)?\\b'].join('|'),
  'gi',
);

/** SQL → highlighted spans. Anything unmatched stays plain text. */
export function highlightSql(sql: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  TOKENS.lastIndex = 0;
  for (let m = TOKENS.exec(sql); m; m = TOKENS.exec(sql)) {
    if (m.index > last) {
      out.push(sql.slice(last, m.index));
    }
    const text = m[0];
    const cls = m[1]
      ? 'text-slate-500 italic' // comment
      : m[2]
        ? 'text-emerald-400' // string literal
        : /^[\d.]+$/.test(text)
          ? 'text-amber-300' // number
          : 'text-sky-400 font-medium'; // keyword
    out.push(
      <span key={`t${key++}`} className={cls}>
        {text}
      </span>,
    );
    last = m.index + text.length;
  }
  out.push(sql.slice(last));
  return out;
}
