import { describe, expect, it } from 'vitest';
import { type DialogSnapshot, diffDialogChanges } from '../src/lib/messageApi/dialogEvents';

function dialog(key: string, patch: Partial<DialogSnapshot> = {}): DialogSnapshot {
  return {
    kind: 'dialog',
    key,
    tdsDialogId: `tds-${key}`,
    appId: key.split(':')[0],
    name: 'Reports',
    url: 'https://example.test/reports',
    ...patch,
  };
}

describe('diffDialogChanges', () => {
  it('reports an open and a close with both identities', () => {
    const a = dialog('app:0');
    expect(diffDialogChanges([], [a])).toEqual([
      {
        state: 'opened',
        kind: 'dialog',
        id: 'app:0',
        tdsDialogId: 'tds-app:0',
        appId: 'app',
        name: 'Reports',
        url: 'https://example.test/reports',
        hidden: false,
      },
    ]);
    expect(diffDialogChanges([a], []).map((c) => c.state)).toEqual(['closed']);
  });

  it('reports hide → show round trips and renames, but not a raise', () => {
    const a = dialog('app:0');
    const b = dialog('app:1');
    expect(diffDialogChanges([a, b], [b, a])).toEqual([]);
    expect(diffDialogChanges([a, b], [{ ...a, hidden: true }, b]).map((c) => c.state)).toEqual(['hidden']);
    expect(diffDialogChanges([{ ...a, hidden: true }, b], [b, a]).map((c) => c.state)).toEqual(['shown']);
    const renamed = diffDialogChanges([a, b], [a, { ...b, name: 'Detail report' }]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ state: 'renamed', id: 'app:1', name: 'Detail report' });
  });

  it('reports a held close as closing, then closed', () => {
    const a = dialog('app:0');
    expect(diffDialogChanges([a], [{ ...a, closing: true }]).map((c) => c.state)).toEqual(['closing']);
    expect(diffDialogChanges([{ ...a, closing: true }], []).map((c) => c.state)).toEqual(['closed']);
  });

  it('orders closed, then state changes, then opened within one step', () => {
    const a = dialog('app:0');
    const b = dialog('app:1');
    const c = dialog('ext:app:2', { kind: 'panel' });
    const changes = diffDialogChanges([a, b], [{ ...b, hidden: true, name: 'X' }, c]);
    expect(changes.map((x) => `${x.state} ${x.id}`)).toEqual([
      'closed app:0',
      'hidden app:1',
      'renamed app:1',
      'opened ext:app:2',
    ]);
    expect(changes[3].kind).toBe('panel');
  });
});
