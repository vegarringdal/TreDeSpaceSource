import { describe, expect, it } from 'vitest';
import { validateViewerPatch } from '../src/lib/messageApi/settingsPatch';
import {
  basisFromQuat,
  dotAlpha,
  type GizmoBasis,
  isNorthMarkerRedundant,
  layoutAxisGizmo,
  northDirection,
  northMarkerLabel,
  pickAxisGizmo,
  snapDirections,
  wrapDegrees,
} from '../src/lib/render/axisGizmo';
import type { ViewerState } from '../src/state/viewer/viewer.state';
import { enumOr, SETTINGS_TAB_KEYS, VIEWER_SECTION_KEYS } from '../src/state/viewer/viewerSettingsGroups';

// the camera on the front side (−Y) looking at +Y, Z up: screen right = +X
const FRONT_VIEW: GizmoBasis = { right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0] };

const DEFAULT_LETTERS = { front: 'F', back: 'B', left: 'L', right: 'R', top: 'T', bottom: 'Bo' };
const COMPASS_LETTERS = { front: 'S', back: 'N', left: 'W', right: 'E', top: 'U', bottom: 'D' };

const NAV_DEFAULTS: Pick<ViewerState, (typeof VIEWER_SECTION_KEYS.navGizmo)[number]> = {
  gizmoStyle: 'balls',
  gizmoBallClick: 'viewFrom',
  gizmoSnapDots: 'iso',
  topViewHeading: 'keep',
  northAngle: 0,
  gizmoNorthMarker: false,
};

describe('axis gizmo layout', () => {
  it('has 12 snap dots for iso and the cube’s full 20 for all, all unit length', () => {
    expect(snapDirections('iso')).toHaveLength(12);
    expect(snapDirections('all')).toHaveLength(20);
    for (const d of snapDirections('all')) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    }
  });

  it('reads the gizmo basis from the camera quaternion like the cube pass', () => {
    const b = basisFromQuat({ x: 0, y: 0, z: 0, w: 1 });
    expect(b.right).toEqual([1, 0, 0]);
    expect(b.up).toEqual([0, 1, 0]);
    expect(b.back).toEqual([0, 0, 1]);
  });

  it('fades dots in on the near side only, and hides the view the camera already has', () => {
    expect(dotAlpha(-0.5)).toBe(0);
    expect(dotAlpha(0.1)).toBe(0);
    expect(dotAlpha(0.6)).toBe(1);
    expect(dotAlpha(1)).toBe(0);
  });

  it('shows just the six balls until revealed, sorted back to front', () => {
    const hidden = layoutAxisGizmo(FRONT_VIEW, 'iso', 0);
    expect(hidden.map((i) => i.kind)).toEqual(Array(6).fill('ball'));
    const shown = layoutAxisGizmo(FRONT_VIEW, 'iso', 1);
    expect(shown.some((i) => i.kind === 'dot')).toBe(true);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i].depth).toBeGreaterThanOrEqual(shown[i - 1].depth);
    }
    // no dot behind the gizmo's centre plane
    expect(shown.filter((i) => i.kind === 'dot').every((i) => i.depth > 0)).toBe(true);
  });

  it('picks the nearest item first and skips faint dots', () => {
    const items = layoutAxisGizmo(FRONT_VIEW, 'iso', 1);
    // the front and back balls overlap at the centre: the front one wins
    expect(pickAxisGizmo(items, 0, 0)?.id).toBe('ball:front');
    // the top ball sits above the centre (y down)
    expect(pickAxisGizmo(items, 0, -0.8)?.id).toBe('ball:top');
    const dot = items.find((i) => i.kind === 'dot');
    expect(dot).toBeDefined();
    if (dot) {
      expect(pickAxisGizmo(items, dot.x, dot.y)?.id).toBe(dot.id);
      const faint = layoutAxisGizmo(FRONT_VIEW, 'iso', 0.2);
      expect(pickAxisGizmo(faint, dot.x, dot.y)).toBeNull();
    }
  });
});

describe('true north', () => {
  it('wraps angles to (−180, 180]', () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(540)).toBe(180);
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(-90)).toBe(-90);
  });

  it('turns +Y clockwise (seen from above) by the north angle', () => {
    const east = northDirection(90);
    expect(east[0]).toBeCloseTo(1, 9);
    expect(east[1]).toBeCloseTo(0, 9);
  });

  it('labels the marker TN when a face letter is already N', () => {
    expect(northMarkerLabel(DEFAULT_LETTERS)).toBe('N');
    expect(northMarkerLabel(COMPASS_LETTERS)).toBe('TN');
  });

  it('drops the marker only when north points straight at a face lettered N', () => {
    expect(isNorthMarkerRedundant(0, COMPASS_LETTERS)).toBe(true);
    expect(isNorthMarkerRedundant(0, DEFAULT_LETTERS)).toBe(false);
    expect(isNorthMarkerRedundant(30, COMPASS_LETTERS)).toBe(false);
    const frontIsNorth = { ...DEFAULT_LETTERS, front: 'N' };
    expect(isNorthMarkerRedundant(180, frontIsNorth)).toBe(true);
    expect(isNorthMarkerRedundant(-180, frontIsNorth)).toBe(true);
  });
});

describe('navigation gizmo settings', () => {
  it('validates the style and the other choices as enums', () => {
    const ok = validateViewerPatch({ gizmoStyle: 'cube', northAngle: 30 }, VIEWER_SECTION_KEYS.navGizmo, NAV_DEFAULTS);
    expect(ok).toEqual({ ok: true, patch: { gizmoStyle: 'cube', northAngle: 30 }, reset: false });
    expect(validateViewerPatch({ gizmoStyle: 'sphere' }, VIEWER_SECTION_KEYS.navGizmo, NAV_DEFAULTS).ok).toBe(false);
    expect(validateViewerPatch({ topViewHeading: 'up' }, VIEWER_SECTION_KEYS.navGizmo, NAV_DEFAULTS).ok).toBe(false);
  });

  it('still takes an existing host payload (cube colours only) on the gizmo tab', () => {
    const tabDefaults: Pick<ViewerState, (typeof SETTINGS_TAB_KEYS.gizmo)[number]> = {
      ...NAV_DEFAULTS,
      cubeFaceColor: '#2f3641',
      cubeLineColor: '#4d5665',
      cubeTextColor: '#c9cfd8',
      cubeHoverColor: '#4a6d9c',
    };
    const r = validateViewerPatch({ cubeFaceColor: '#1e2a3a' }, SETTINGS_TAB_KEYS.gizmo, tabDefaults);
    expect(r).toEqual({ ok: true, patch: { cubeFaceColor: '#1e2a3a' }, reset: false });
  });

  it('falls back to the default for an unknown stored value (no validation on load)', () => {
    expect(enumOr('gizmoStyle', 'cube', 'balls')).toBe('cube');
    expect(enumOr('gizmoStyle', 'sphere', 'balls')).toBe('balls');
    expect(enumOr('gizmoStyle', undefined, 'balls')).toBe('balls');
    expect(enumOr('topViewHeading', 42, 'keep')).toBe('keep');
  });
});
