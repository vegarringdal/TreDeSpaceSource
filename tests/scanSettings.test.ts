// The remembered Scans panel settings (state/scans/scanSettings.ts): what is
// saved, how a saved blob is read back, and the two groups the panel resets.
import { describe, expect, it } from 'vitest';
import {
  PHOTO_SETTING_KEYS,
  POINT_SETTING_KEYS,
  parseSettings,
  photoSettings,
  pickSettings,
  pointSettings,
  type ScanSettings,
  sameSettings,
} from '../src/state/scans/scanSettings';

const DEFAULTS: ScanSettings = {
  pointsMode: 'always',
  pointSize: 1,
  pointBudget: 5,
  colorMode: 'rgb',
  adaptive: false,
  pointAdaptiveMax: 2,
  pointMaxDistance: 0,
  pointFocusDistance: 0,
  pointInViewBudget: true,
  pointInViewLoad: true,
  pointMoveLight: true,
  pointDetail: 1,
  pointCache: 50,
  onlySetupPoints: true,
  opacity: 100,
  mode: 'over',
  showMarkers: true,
  markerOpacity: 100,
};

describe('parseSettings', () => {
  it('gives the defaults for nothing, for junk and for a non-object', () => {
    expect(parseSettings(null, DEFAULTS)).toEqual(DEFAULTS);
    expect(parseSettings('{not json', DEFAULTS)).toEqual(DEFAULTS);
    expect(parseSettings('[1, 2]', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('reads back what was saved', () => {
    const saved: ScanSettings = {
      ...DEFAULTS,
      pointsMode: 'entered',
      pointBudget: 20,
      pointMaxDistance: 7.5,
      adaptive: true,
      colorMode: 'intensity',
      mode: 'background',
      markerOpacity: 40,
    };
    expect(parseSettings(JSON.stringify(saved), DEFAULTS)).toEqual(saved);
  });

  it('falls back per value: a wrong kind or an unknown choice keeps the default', () => {
    const text = JSON.stringify({
      pointsMode: 'sometimes',
      pointBudget: '20',
      pointDetail: null,
      adaptive: 1,
      colorMode: 'rgb',
      pointCache: 25,
      mode: 'under',
      opacity: 60,
      somethingOld: true,
    });
    expect(parseSettings(text, DEFAULTS)).toEqual({ ...DEFAULTS, pointCache: 25, opacity: 60 });
  });
});

describe('the two groups', () => {
  it('cover every remembered setting once', () => {
    const all = [...POINT_SETTING_KEYS, ...PHOTO_SETTING_KEYS].sort();
    expect(all).toEqual(Object.keys(DEFAULTS).sort());
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(pointSettings(DEFAULTS)).sort()).toEqual([...POINT_SETTING_KEYS].sort());
    expect(Object.keys(photoSettings(DEFAULTS)).sort()).toEqual([...PHOTO_SETTING_KEYS].sort());
    expect(pickSettings(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('compare and reset on their own', () => {
    const changed: ScanSettings = { ...DEFAULTS, pointBudget: 12, opacity: 30 };
    expect(sameSettings(changed, DEFAULTS, POINT_SETTING_KEYS)).toBe(false);
    expect(sameSettings(changed, DEFAULTS, PHOTO_SETTING_KEYS)).toBe(false);
    const pointsReset = { ...changed, ...pointSettings(DEFAULTS) };
    expect(sameSettings(pointsReset, DEFAULTS, POINT_SETTING_KEYS)).toBe(true);
    // the photo group is untouched by the point cloud reset
    expect(pointsReset.opacity).toBe(30);
    expect(sameSettings({ ...pointsReset, ...photoSettings(DEFAULTS) }, DEFAULTS, PHOTO_SETTING_KEYS)).toBe(true);
  });
});
