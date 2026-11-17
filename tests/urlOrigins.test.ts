import { describe, expect, it } from 'vitest';
import { decideUrlOrigins, parseUrlOrigins } from '../src/lib/messageApi/urlOrigins';

const HOST = 'https://portal.example.com';

describe('parseUrlOrigins', () => {
  it('reads a comma-separated list, trimmed and deduped', () => {
    expect(parseUrlOrigins(`?apiOrigins=${HOST}, https://other.example.com,${HOST},`)).toEqual([
      HOST,
      'https://other.example.com',
    ]);
  });

  it('never accepts * from a URL', () => {
    expect(parseUrlOrigins('?apiOrigins=*')).toEqual([]);
    expect(parseUrlOrigins(`?apiOrigins=*,${HOST}`)).toEqual([HOST]);
  });

  it('is empty without the parameter', () => {
    expect(parseUrlOrigins('?model=a')).toEqual([]);
  });
});

describe('decideUrlOrigins', () => {
  const origins = [HOST];

  it('trusts a frame for the session while the viewer holds nothing', () => {
    expect(decideUrlOrigins({ origins, role: 'frame', isStorageEmpty: true })).toEqual({
      kind: 'trust-session',
      origins,
    });
  });

  it('asks in a frame once the viewer holds data', () => {
    expect(decideUrlOrigins({ origins, role: 'frame', isStorageEmpty: false })).toEqual({ kind: 'ask', origins });
  });

  it('always asks in a window another page opened', () => {
    expect(decideUrlOrigins({ origins, role: 'popup', isStorageEmpty: true })).toEqual({ kind: 'ask', origins });
  });

  it('ignores the parameter in a window nobody opened', () => {
    expect(decideUrlOrigins({ origins, role: 'top', isStorageEmpty: true })).toEqual({ kind: 'ignore' });
  });

  it('ignores an empty list', () => {
    expect(decideUrlOrigins({ origins: [], role: 'frame', isStorageEmpty: true })).toEqual({ kind: 'ignore' });
  });
});
