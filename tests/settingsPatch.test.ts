import { describe, expect, it } from 'vitest';
import { validateViewerPatch } from '../src/lib/messageApi/settingsPatch';
import type { ViewerState } from '../src/state/viewer/viewer.state';
import { SETTINGS_TAB_KEYS, VIEWER_SECTION_KEYS } from '../src/state/viewer/viewerSettingsGroups';

// the AO tab's defaults, typed so the validator sees the real value shapes
const AO_DEFAULTS: Pick<ViewerState, (typeof VIEWER_SECTION_KEYS.ao)[number]> = {
  aoMode: 0,
  aoRadius: 0.8,
  aoStrength: 0.15,
  aoSlices: 6,
  aoSamples: 6,
};

const LIGHT_DEFAULTS: Pick<ViewerState, (typeof VIEWER_SECTION_KEYS.lighting)[number]> = {
  ambientColor: '#ffffff',
  ambientIntensity: 0.3,
  headlightColor: '#ffffff',
  headlightIntensity: 0.65,
};

describe('validateViewerPatch', () => {
  it('accepts a typed partial and reads out reset', () => {
    const r = validateViewerPatch({ aoMode: 1, aoRadius: 1.2, reset: true }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS);
    expect(r).toEqual({ ok: true, patch: { aoMode: 1, aoRadius: 1.2 }, reset: true });
  });

  it('rejects unknown keys, naming the allowed ones', () => {
    const r = validateViewerPatch({ aoRadiu: 1 }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('aoRadius');
  });

  it('rejects wrong primitive types and non-finite numbers', () => {
    expect(validateViewerPatch({ aoRadius: '1' }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS).ok).toBe(false);
    expect(validateViewerPatch({ aoRadius: Number.NaN }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS).ok).toBe(false);
    expect(validateViewerPatch({ reset: 'yes' }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS).ok).toBe(false);
  });

  it('checks enum members', () => {
    expect(validateViewerPatch({ aoMode: 3 }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS).ok).toBe(false);
    expect(validateViewerPatch({ aoMode: '1' }, VIEWER_SECTION_KEYS.ao, AO_DEFAULTS).ok).toBe(false);
  });

  it('normalises colours to #rrggbb and accepts CSS names', () => {
    const r = validateViewerPatch(
      { ambientColor: 'Red', headlightColor: '#ABC' },
      VIEWER_SECTION_KEYS.lighting,
      LIGHT_DEFAULTS,
    );
    expect(r).toEqual({ ok: true, patch: { ambientColor: '#ff0000', headlightColor: '#aabbcc' }, reset: false });
    expect(validateViewerPatch({ ambientColor: 'nope' }, VIEWER_SECTION_KEYS.lighting, LIGHT_DEFAULTS).ok).toBe(false);
  });

  it('tab groups contain no duplicate keys', () => {
    for (const keys of Object.values(SETTINGS_TAB_KEYS)) {
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
