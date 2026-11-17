// The Scans panel's settings that are remembered between sessions, in the two
// groups the panel resets separately (Point cloud, Photo). Pure — it knows the
// state's shape, not the store — so it is unit-tested as it is.
import type { ScansState } from './scans.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type ScanSettingKey = (typeof POINT_SETTING_KEYS)[number] | (typeof PHOTO_SETTING_KEYS)[number];

/** The remembered part of the scans state. */
export type ScanSettings = Pick<ScansState, ScanSettingKey>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The "Point cloud" group. */
export const POINT_SETTING_KEYS = [
  'pointsMode',
  'pointSize',
  'pointBudget',
  'colorMode',
  'adaptive',
  'pointAdaptiveMax',
  'pointMaxDistance',
  'pointFocusDistance',
  'pointInViewBudget',
  'pointInViewLoad',
  'pointMoveLight',
  'pointDetail',
  'pointCache',
  'onlySetupPoints',
] as const satisfies readonly (keyof ScansState)[];

/** The "Photo" group. */
export const PHOTO_SETTING_KEYS = [
  'opacity',
  'mode',
  'showMarkers',
  'markerOpacity',
] as const satisfies readonly (keyof ScansState)[];

const NUMBER_KEYS = [
  'pointSize',
  'pointAdaptiveMax',
  'pointBudget',
  'pointMaxDistance',
  'pointFocusDistance',
  'pointDetail',
  'pointCache',
  'opacity',
  'markerOpacity',
] as const satisfies readonly ScanSettingKey[];

const BOOLEAN_KEYS = [
  'adaptive',
  'pointInViewBudget',
  'pointInViewLoad',
  'pointMoveLight',
  'onlySetupPoints',
  'showMarkers',
] as const satisfies readonly ScanSettingKey[];

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isPointsMode = (v: unknown): v is ScansState['pointsMode'] =>
  v === 'off' || v === 'hidden' || v === 'always' || v === 'entered';
const isColorMode = (v: unknown): v is ScansState['colorMode'] => v === 'rgb' || v === 'intensity';
const isPanoMode = (v: unknown): v is ScansState['mode'] => v === 'over' || v === 'background';

/** The remembered settings out of a state (or out of another settings object). */
export function pickSettings(s: ScanSettings): ScanSettings {
  return { ...pointSettings(s), ...photoSettings(s) };
}

/**
 * Saved settings back into shape: every value that is missing or of the wrong
 * kind (an older version's, a hand-edited one) falls back to its default, so a
 * stale blob can never put the panel in a state it cannot show.
 */
export function parseSettings(text: string | null, defaults: ScanSettings): ScanSettings {
  const out: Mutable<ScanSettings> = pickSettings(defaults);
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    return out;
  }
  if (!isRecord(raw)) {
    return out;
  }

  for (const key of NUMBER_KEYS) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    }
  }
  for (const key of BOOLEAN_KEYS) {
    const v = raw[key];
    if (typeof v === 'boolean') {
      out[key] = v;
    }
  }
  if (isPointsMode(raw.pointsMode)) {
    out.pointsMode = raw.pointsMode;
  }
  if (isColorMode(raw.colorMode)) {
    out.colorMode = raw.colorMode;
  }
  if (isPanoMode(raw.mode)) {
    out.mode = raw.mode;
  }
  return out;
}

/** The "Point cloud" group out of a settings object: a patch for the store. */
export function pointSettings(s: ScanSettings): Pick<ScanSettings, (typeof POINT_SETTING_KEYS)[number]> {
  return {
    pointsMode: s.pointsMode,
    pointSize: s.pointSize,
    pointBudget: s.pointBudget,
    colorMode: s.colorMode,
    adaptive: s.adaptive,
    pointAdaptiveMax: s.pointAdaptiveMax,
    pointMaxDistance: s.pointMaxDistance,
    pointFocusDistance: s.pointFocusDistance,
    pointInViewBudget: s.pointInViewBudget,
    pointInViewLoad: s.pointInViewLoad,
    pointMoveLight: s.pointMoveLight,
    pointDetail: s.pointDetail,
    pointCache: s.pointCache,
    onlySetupPoints: s.onlySetupPoints,
  };
}

/** The "Photo" group out of a settings object: a patch for the store. */
export function photoSettings(s: ScanSettings): Pick<ScanSettings, (typeof PHOTO_SETTING_KEYS)[number]> {
  return { opacity: s.opacity, mode: s.mode, showMarkers: s.showMarkers, markerOpacity: s.markerOpacity };
}

/** Whether a group of settings equals another's (the reset button's "dirty"). */
export function sameSettings(a: ScanSettings, b: ScanSettings, keys: readonly ScanSettingKey[]): boolean {
  return keys.every((key) => a[key] === b[key]);
}
