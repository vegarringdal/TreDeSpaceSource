import { describe, expect, it } from 'vitest';
import { type DialogIdStore, dialogIdFor, freshDialogId } from '../src/state/externalDialogIds';

function memoryStore(initial: Record<string, string> = {}): DialogIdStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('dialogIdFor', () => {
  it('is stable per instance key and distinct across keys', () => {
    const store = memoryStore();
    const a = dialogIdFor('ext:app1', store);
    expect(dialogIdFor('ext:app1', store)).toBe(a);
    expect(dialogIdFor('modal:app1', store)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('persists through the store, so a second reader sees the same id', () => {
    const store = memoryStore();
    const a = dialogIdFor('ext:app1', store);
    const again = memoryStore(store.data);
    expect(dialogIdFor('ext:app1', again)).toBe(a);
  });

  it('starts fresh on a corrupt or foreign store value, and without a store', () => {
    expect(dialogIdFor('k', memoryStore({ tdsDialogIds: 'not json' }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(dialogIdFor('k', memoryStore({ tdsDialogIds: '[1,2]' }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(dialogIdFor('k', null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('freshDialogId never repeats', () => {
    expect(freshDialogId()).not.toBe(freshDialogId());
  });
});
