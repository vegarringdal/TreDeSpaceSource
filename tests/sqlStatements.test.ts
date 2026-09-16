// `sql.check` reports the statements a script would RUN, so the labelling has
// to survive comments, string literals and the forms that answer with rows.
import { describe, expect, it } from 'vitest';
import { parseStatements } from '../src/lib/sqlite/sqlAttach';

describe('parseStatements', () => {
  it('drops comments and splits on top-level semicolons', () => {
    const out = parseStatements("-- daily report\nSELECT 1; /* note */ PRAGMA page_size;\n");
    expect(out.map((s) => s.sql)).toEqual(['SELECT 1', 'PRAGMA page_size']);
  });

  it('answers with nothing for a script that is only comments', () => {
    expect(parseStatements('-- nothing here\n/* nor here */')).toEqual([]);
  });

  it('labels the leading keyword and whether rows come back', () => {
    const [sel, ins, cte] = parseStatements('SELECT a FROM t; INSERT INTO t VALUES (1); WITH x AS (SELECT 1) SELECT * FROM x');
    expect(sel).toMatchObject({ kind: 'select', returnsRows: true });
    expect(ins).toMatchObject({ kind: 'insert', returnsRows: false });
    expect(cte).toMatchObject({ kind: 'with', returnsRows: true });
  });

  it('treats a RETURNING clause as row-producing', () => {
    const [st] = parseStatements("UPDATE t SET a = 1 RETURNING a");
    expect(st).toMatchObject({ kind: 'update', returnsRows: true });
  });

  it('reports the path of an ATTACH', () => {
    const [st] = parseStatements("ATTACH DATABASE 'sql_assets/main/tags.db' AS tags");
    expect(st).toMatchObject({ kind: 'attach', returnsRows: false, attach: 'sql_assets/main/tags.db' });
  });

  it('does not split on a semicolon inside a string literal', () => {
    const out = parseStatements("SELECT ';' AS s; SELECT 2");
    expect(out.map((s) => s.sql)).toEqual(["SELECT ';' AS s", 'SELECT 2']);
  });
});
