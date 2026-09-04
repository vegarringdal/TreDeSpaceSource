import { describe, expect, it } from 'vitest';
import { editorDraftPayload, parseEditorDraft } from '../src/lib/messageApi/sqlEditorPayload';
import type { ReportDef } from '../src/state/sqlReports/sqlReports.state';

const draft: ReportDef = {
  id: '__editor__',
  store: '',
  db: 'sql_assets/main/meta.db',
  name: 'Daily defects',
  description: 'open ones',
  types: ['TABLE', 'COLORING'],
  sql: "select * from defects where severity > (select v from FILTER_ARGS where k='minSeverity')",
  databases: ['sql_assets/main/meta.db'],
  filters: [
    { kind: 'INPUT', key: 'minSeverity', label: 'Min severity', value: '2' },
    { kind: 'DROPDOWN', key: 'area', label: 'Area', searchValue: '%', dropdownSql: 'select id, name from areas', selected: ['a1'] },
  ],
};

describe('editorDraftPayload → parseEditorDraft round trip', () => {
  it('maps name ↔ title and keeps types, filters and databases', () => {
    const out = editorDraftPayload(draft);
    expect(out.title).toBe('Daily defects');
    expect(out.mainDb).toBe(draft.db);
    expect(out.databases).toEqual(draft.databases);
    expect(out.filters).toEqual(draft.filters);
    expect(out.filters[1]).not.toBe(draft.filters[1]);

    const back = parseEditorDraft({ ...out });
    expect(back.error).toBeUndefined();
    expect(back.patch).toEqual({
      name: draft.name,
      description: draft.description,
      types: draft.types,
      filters: draft.filters,
    });
  });
});

describe('parseEditorDraft', () => {
  it('leaves out what the payload does not carry', () => {
    expect(parseEditorDraft({ sql: 'select 1' })).toEqual({ patch: {} });
    expect(parseEditorDraft({ title: 'x' })).toEqual({ patch: { name: 'x' } });
  });

  it('defaults a filter to INPUT labelled by its key, dedupes types', () => {
    const r = parseEditorDraft({ types: ['TABLE', 'TABLE'], filters: [{ key: ' k ', value: 'v' }] });
    expect(r.patch).toEqual({ types: ['TABLE'], filters: [{ kind: 'INPUT', key: 'k', label: 'k', value: 'v' }] });
  });

  it('rejects bad fields with a message, without throwing', () => {
    expect(parseEditorDraft({ title: 3 }).error).toBe('title must be a string');
    expect(parseEditorDraft({ types: ['TABLE', 'PIE'] }).error).toMatch(/^types must be an array of/);
    expect(parseEditorDraft({ filters: [{ label: 'no key' }] }).error).toBe('filters[0].key must be a non-empty string');
    expect(parseEditorDraft({ filters: [{ key: 'k', kind: 'RADIO' }] }).error).toBe('filters[0].kind must be INPUT or DROPDOWN');
    expect(parseEditorDraft({ filters: [{ key: 'k', selected: [1] }] }).error).toBe('filters[0].selected must be a string[]');
    expect(parseEditorDraft({ filters: [{ key: 'k', dropdownSql: 5 }] }).error).toBe('filters[0].dropdownSql must be a string');
    expect(parseEditorDraft({ filters: 'nope' }).error).toBe('filters must be an array');
  });
});
