// Two tabs sharing one JSON library (the asset index): a save must apply only
// what its own tab changed, so neither tab drops what the other added.

import { describe, expect, it } from 'vitest';
import { mergeGroupedStrings, mergeKeyed } from '../src/lib/opfs/keyedMerge';
import { createSharedDoc, type SharedDoc } from '../src/lib/opfs/sharedDoc';

interface Asset {
  id: string;
  name: string;
}

const keyOf = (a: Asset): string => a.id;
const asset = (id: string, name = id): Asset => ({ id, name });

describe('mergeKeyed', () => {
  it('keeps a record another tab added', () => {
    const base = [asset('a')];
    expect(mergeKeyed(base, [asset('a', 'renamed')], [asset('a'), asset('scan')], keyOf)).toEqual([
      asset('a', 'renamed'),
      asset('scan'),
    ]);
  });

  it('applies this tab’s add, edit and remove', () => {
    const base = [asset('a'), asset('b'), asset('c')];
    const mine = [asset('a', 'A'), asset('c'), asset('d')];
    expect(mergeKeyed(base, mine, base, keyOf)).toEqual([asset('a', 'A'), asset('c'), asset('d')]);
  });

  it('takes the other tab’s edit of a record this tab left alone', () => {
    const base = [asset('a'), asset('b')];
    expect(mergeKeyed(base, base, [asset('a', 'theirs'), asset('b')], keyOf)).toEqual([asset('a', 'theirs'), asset('b')]);
  });

  it('does not bring back a record the other tab deleted', () => {
    const base = [asset('a'), asset('b')];
    expect(mergeKeyed(base, [asset('a'), asset('b', 'edited')], [asset('a')], keyOf)).toEqual([asset('a')]);
  });

  it('lets this tab’s edit win over the other tab’s edit', () => {
    const base = [asset('a')];
    expect(mergeKeyed(base, [asset('a', 'mine')], [asset('a', 'theirs')], keyOf)).toEqual([asset('a', 'mine')]);
  });
});

describe('mergeGroupedStrings', () => {
  it('merges folder lists per store and drops emptied stores', () => {
    const base = { main: ['pipes'], old: ['x'] };
    const mine = { main: ['pipes', 'steel'], old: [] };
    const theirs = { main: ['pipes'], old: ['x'], scans: ['2026'] };
    expect(mergeGroupedStrings(base, mine, theirs)).toEqual({ main: ['pipes', 'steel'], scans: ['2026'] });
  });
});

// -----------------------------------------------------------------------------
// two tabs on one disk
// -----------------------------------------------------------------------------

interface Disk {
  file: Asset[] | null;
  isBroken: boolean;
  writes: number;
  queue: Promise<unknown>;
  tabs: Tab[];
}

interface Tab {
  state: Asset[];
  doc: SharedDoc<Asset[]>;
  /** Called by a write while it is in flight — to change state mid-save. */
  duringWrite: (() => void) | null;
}

function createDisk(file: Asset[] | null = null): Disk {
  return { file, isBroken: false, writes: 0, queue: Promise.resolve(), tabs: [] };
}

/** A tab whose saves notify the other tabs on the disk, as the channel does. */
function openTab(disk: Disk): Tab {
  const tab: Tab = {
    state: [],
    duringWrite: null,
    doc: createSharedDoc<Asset[]>({
      empty: [],
      merge: (base, mine, theirs) => mergeKeyed(base, mine, theirs, keyOf),
      get: () => tab.state,
      set: (value) => {
        tab.state = value;
      },
      io: {
        lock<R>(body: () => Promise<R>): Promise<R> {
          const run = disk.queue.then(body);
          disk.queue = run.catch(() => undefined);

          return run;
        },
        async read() {
          if (disk.isBroken) {
            throw new Error('unreadable');
          }

          return disk.file ? structuredClone(disk.file) : null;
        },
        async write(value) {
          tab.duringWrite?.();
          disk.file = structuredClone(value);
          disk.writes++;
        },
        notify() {
          for (const other of disk.tabs) {
            if (other !== tab) {
              void other.doc.refresh();
            }
          }
        },
      },
    }),
  };
  disk.tabs.push(tab);

  return tab;
}

async function openLoadedTab(disk: Disk): Promise<Tab> {
  const tab = openTab(disk);
  tab.state = await tab.doc.load();

  return tab;
}

const settle = (disk: Disk): Promise<unknown> => disk.queue;

describe('createSharedDoc', () => {
  it('keeps an import from one tab when a stale tab saves', async () => {
    const disk = createDisk([asset('model')]);
    const a = await openLoadedTab(disk);
    const b = await openLoadedTab(disk);
    disk.tabs.length = 0; // no cross-tab note: B stays stale, the worst case

    a.state = [...a.state, asset('scan')];
    await a.doc.save();
    b.state = b.state.map((x) => (x.id === 'model' ? asset('model', 'renamed') : x));
    await b.doc.save();

    expect(disk.file).toEqual([asset('model', 'renamed'), asset('scan')]);
    expect(b.state).toEqual([asset('model', 'renamed'), asset('scan')]);
  });

  it('refreshes the other tab after a save', async () => {
    const disk = createDisk([asset('model')]);
    const a = await openLoadedTab(disk);
    const b = await openLoadedTab(disk);

    a.state = [...a.state, asset('scan')];
    await a.doc.save();
    await settle(disk);

    expect(b.state).toEqual([asset('model'), asset('scan')]);
  });

  it('keeps a tab’s unsaved change through a refresh', async () => {
    const disk = createDisk([asset('model')]);
    const a = await openLoadedTab(disk);
    const b = await openLoadedTab(disk);

    b.state = [...b.state, asset('draft')];
    a.state = [...a.state, asset('scan')];
    await a.doc.save();
    await settle(disk);
    expect(b.state).toEqual([asset('model'), asset('draft'), asset('scan')]);

    await b.doc.save();
    expect(disk.file).toEqual([asset('model'), asset('draft'), asset('scan')]);
  });

  it('keeps a change made while the write was in flight', async () => {
    const disk = createDisk([asset('model')]);
    const a = await openLoadedTab(disk);

    a.state = [...a.state, asset('first')];
    a.duringWrite = () => {
      a.state = [...a.state, asset('second')];
      a.duringWrite = null;
    };
    await a.doc.save();
    expect(a.state).toEqual([asset('model'), asset('first'), asset('second')]);

    await a.doc.save();
    expect(disk.file).toEqual([asset('model'), asset('first'), asset('second')]);
  });

  it('removes on disk what this tab deleted, and nothing else', async () => {
    const disk = createDisk([asset('a'), asset('b')]);
    const a = await openLoadedTab(disk);
    const b = await openLoadedTab(disk);
    disk.tabs.length = 0;

    a.state = [...a.state, asset('c')];
    await a.doc.save();
    b.state = b.state.filter((x) => x.id !== 'a');
    await b.doc.save();

    expect(disk.file).toEqual([asset('b'), asset('c')]);
  });

  it('writes nothing when nothing changed', async () => {
    const disk = createDisk([asset('model')]);
    const a = await openLoadedTab(disk);

    await a.doc.save();

    expect(disk.writes).toBe(0);
  });

  it('does not empty the file when it cannot be read during a save', async () => {
    const disk = createDisk([asset('a'), asset('b')]);
    const a = await openLoadedTab(disk);

    disk.isBroken = true;
    a.state = [...a.state, asset('c')];
    await a.doc.save();

    expect(disk.file).toEqual([asset('a'), asset('b'), asset('c')]);
  });

  it('ignores a refresh before the tab has loaded', async () => {
    const disk = createDisk([asset('model')]);
    const a = openTab(disk);

    await a.doc.refresh();

    expect(a.state).toEqual([]);
  });
});
