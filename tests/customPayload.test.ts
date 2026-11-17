import { describe, expect, it } from 'vitest';
import {
  MAX_DATA_CHARS,
  parseClientLabel,
  parseEventFilter,
  parseEventName,
  parseJsonData,
  parseTargets,
} from '../src/lib/messageApi/customPayload';

describe('custom-event payload parsing', () => {
  it('event names are non-empty strings within the cap', () => {
    expect(parseEventName('row.pick')).toEqual({ ok: true, value: 'row.pick' });
    expect(parseEventName('').ok).toBe(false);
    expect(parseEventName('x'.repeat(129)).ok).toBe(false);
    expect(parseEventName(42).ok).toBe(false);
  });

  it('event filter: omitted = all, empty = presence only, else names', () => {
    expect(parseEventFilter(undefined)).toEqual({ ok: true, value: null });
    expect(parseEventFilter([])).toEqual({ ok: true, value: [] });
    expect(parseEventFilter(['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(parseEventFilter(['a', 1]).ok).toBe(false);
    expect(parseEventFilter('a').ok).toBe(false);
  });

  it('targets: omitted = broadcast, one id or a non-empty list', () => {
    expect(parseTargets(undefined)).toEqual({ ok: true, value: null });
    expect(parseTargets('c3')).toEqual({ ok: true, value: ['c3'] });
    expect(parseTargets(['c3', 'c9'])).toEqual({ ok: true, value: ['c3', 'c9'] });
    expect(parseTargets([]).ok).toBe(false);
    expect(parseTargets(['']).ok).toBe(false);
  });

  it('client name and tag are optional', () => {
    expect(parseClientLabel(undefined, 'name')).toEqual({ ok: true, value: undefined });
    expect(parseClientLabel('report', 'name').ok).toBe(true);
    expect(parseClientLabel(' ', 'name').ok).toBe(false);
    expect(parseClientLabel('v2', 'tag')).toEqual({ ok: true, value: 'v2' });
    expect(parseClientLabel(3, 'tag')).toEqual({ ok: false, error: 'tag must be a non-empty string' });
  });

  it('data is normalised through JSON and capped', () => {
    expect(parseJsonData(undefined)).toEqual({ ok: true, value: null });
    const d = new Date(0);
    expect(parseJsonData({ when: d, gone: undefined })).toEqual({ ok: true, value: { when: d.toISOString() } });
    expect(parseJsonData(() => 1).ok).toBe(false);
    expect(parseJsonData(1n).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(parseJsonData(cyclic).ok).toBe(false);
    expect(parseJsonData('x'.repeat(MAX_DATA_CHARS)).ok).toBe(false);
  });
});
