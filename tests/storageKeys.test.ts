import { describe, expect, it } from 'vitest';
import {
  clearViewerStorage,
  type KeyValueStore,
  migrateLegacyStorage,
  storageKey,
  storageName,
  viewerStorageKeys,
} from '../src/lib/storageKeys';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('storageKey / storageName', () => {
  it('prefixes and reverses', () => {
    expect(storageKey('settings')).toBe('tds:settings');
    expect(storageName('tds:settings')).toBe('settings');
    expect(storageName('settings')).toBeNull();
    expect(storageName('tds:somebodyElse')).toBeNull();
  });
});

describe('migrateLegacyStorage', () => {
  it('copies bare names once, keeps existing prefixed values, leaves the legacy keys', () => {
    const s = memoryStore({ settings: '{"a":1}', viewer: '{"b":2}', 'tds:viewer': '{"mine":1}', hostThing: 'x' });
    expect(migrateLegacyStorage(s)).toBe(1);
    expect(s.data['tds:settings']).toBe('{"a":1}');
    expect(s.data['tds:viewer']).toBe('{"mine":1}');
    expect(s.data.settings).toBe('{"a":1}');
    expect(s.data.hostThing).toBe('x');
    // a second run is a no-op, even after the prefixed key was reset
    delete s.data['tds:settings'];
    expect(migrateLegacyStorage(s)).toBe(0);
    expect(s.data['tds:settings']).toBeUndefined();
  });

  it('is a no-op without a store', () => {
    expect(migrateLegacyStorage(null)).toBe(0);
  });
});

describe('clearViewerStorage', () => {
  it('removes only tds: keys and keeps the migration marker', () => {
    const s = memoryStore({ 'tds:settings': '1', 'tds:layouts': '2', settings: 'host', other: 'host' });
    migrateLegacyStorage(s);
    expect(viewerStorageKeys(s).sort()).toEqual(['tds:layouts', 'tds:migrated', 'tds:settings']);
    expect(clearViewerStorage(s)).toBe(3);
    expect(Object.keys(s.data).sort()).toEqual(['other', 'settings', 'tds:migrated']);
    // the legacy value must not come back on the next launch
    expect(migrateLegacyStorage(s)).toBe(0);
  });
});
