// Scene-annotation commands: selection, labels (content + layout) and
// measurements. See EVENTS.md for the payload contracts.

import { openViewpointViewerPanelRight } from '../../components/panels/viewpoints/viewpointsPanel';
import { db } from '../../state/viewer/db';
import { labelsActions } from '../../state/viewer/labels.actions';
import { labelsState, MAX_LABELS, type SceneLabel } from '../../state/viewer/labels.state';
import { measurementsActions } from '../../state/viewer/measurements.actions';
import { measurementsState } from '../../state/viewer/measurements.state';
import { selectionState } from '../../state/viewer/selection.state';
import { readSphereMarker } from '../../state/viewer/sphereMarker';
import { viewerActions } from '../../state/viewer/viewer.actions';
import { viewpointsActions } from '../../state/viewer/viewpoints.actions';
import { packedFromBytes } from '../color/packedNames';
import {
  ApiError,
  type ApiHandler,
  boolOpt,
  isRecord,
  nameListBytes,
  oneOf,
  records,
  strings,
  strOpt,
  vec3,
} from './protocol';

const setOrAddLabels: ApiHandler = async ({ type, p }) => {
  const inputs = records(p.labels, 'labels');
  const wantNames = [...new Set(inputs.map((l) => l.fullname).filter((n): n is string => typeof n === 'string'))];
  const { found, notFound } = wantNames.length ? await db.findLabelAnchors(wantNames) : { found: [], notFound: [] };
  const centers = new Map(found.map((f) => [f.name.toLowerCase().replace(/^\//, ''), f.center]));
  const s = labelsState.get();
  const items: SceneLabel[] = [];
  for (const l of inputs) {
    const text = typeof l.text === 'string' ? l.text : '';
    let anchor: [number, number, number] | null = null;
    let fullname: string | null = null;
    if (typeof l.fullname === 'string') {
      const c = centers.get(l.fullname.trim().toLowerCase().replace(/^\//, ''));
      if (!c) {
        continue; // reported via missed
      }
      anchor = c;
      fullname = l.fullname;
    } else if (Array.isArray(l.anchor) && l.anchor.length === 3) {
      anchor = [Number(l.anchor[0]), Number(l.anchor[1]), Number(l.anchor[2])];
    } else {
      throw new ApiError('bad-payload', 'each label needs a fullname or an anchor [x,y,z]');
    }
    items.push({
      id: 0, // rebased by setAll
      text,
      fullname,
      anchor,
      offset: [0, 0],
      selected: false,
      bg: s.bg,
      opacity: s.opacity,
      textColor: s.textColor,
      // explicit marker (or `true` for the panel default); omitted = the panel style
      sphere: l.sphere === undefined ? s.sphere : readSphereMarker(l.sphere),
    });
  }
  const base = type === 'labels.set' ? [] : s.items;
  const combined = [...base, ...items].slice(0, MAX_LABELS);
  labelsActions.setAll(combined);
  return { added: items.length, missed: notFound };
};

const MEASURE_KINDS = ['point', 'line', 'path', 'area', 'diameter', 'angle', 'face'] as const;
/** Per-axis flag triples (`axisLegs` / `axisLabels`). */
const NO_AXES: [boolean, boolean, boolean] = [false, false, false];

function readAxisFlags(v: unknown, what: string): [boolean, boolean, boolean] {
  if (v === undefined || v === null) {
    return [...NO_AXES];
  }
  if (!Array.isArray(v) || v.length !== 3) {
    throw new ApiError('bad-payload', `${what} must be an array of 3 booleans`);
  }
  return [boolOpt(v[0], `${what}[0]`, false), boolOpt(v[1], `${what}[1]`, false), boolOpt(v[2], `${what}[2]`, false)];
}

/** One measurement point: `pos` is required, `normal` / `clicked` optional —
 *  all three fixed-length number triples. */
function readMeasurePoint(v: unknown, what: string) {
  if (!isRecord(v)) {
    throw new ApiError('bad-payload', `${what} must be an object with a pos`);
  }
  return {
    pos: vec3(v.pos, `${what}.pos`),
    ...(v.normal === undefined || v.normal === null ? {} : { normal: vec3(v.normal, `${what}.normal`) }),
    ...(v.clicked === undefined || v.clicked === null ? {} : { clicked: vec3(v.clicked, `${what}.clicked`) }),
  };
}

/** One `measurements.set` / `.add` entry, fully validated. `importJson`
 *  backfills defaults but only ever checked `kind` and that `points` is an
 *  array — a point of `['x']` reached the overlay geometry as NaN. */
function readMeasurement(x: Record<string, unknown>, i: number) {
  const what = `measurements[${i}]`;
  const points = Array.isArray(x.points) ? x.points : null;
  if (!points) {
    throw new ApiError('bad-payload', `${what}.points must be an array`);
  }
  return {
    id: i + 1,
    kind: oneOf(x.kind, `${what}.kind`, MEASURE_KINDS),
    points: points.map((pt, j) => readMeasurePoint(pt, `${what}.points[${j}]`)),
    label: strOpt(x.label, `${what}.label`, '', 4096),
    visible: boolOpt(x.visible, `${what}.visible`, true),
    showLabel: boolOpt(x.showLabel, `${what}.showLabel`, true),
    showPerp: boolOpt(x.showPerp, `${what}.showPerp`, false),
    axisLegs: readAxisFlags(x.axisLegs, `${what}.axisLegs`),
    axisLabels: readAxisFlags(x.axisLabels, `${what}.axisLabels`),
    legsInLabel: boolOpt(x.legsInLabel, `${what}.legsInLabel`, false),
    slopeInLabel: boolOpt(x.slopeInLabel, `${what}.slopeInLabel`, false),
    flipAngle: boolOpt(x.flipAngle, `${what}.flipAngle`, false),
    // readSphereMarker is already defensive about its own fields
    sphere: x.sphere,
  };
}

const setOrAddMeasurements: ApiHandler = ({ type, p }) => {
  const inputs = records(p.measurements, 'measurements');
  const cur = measurementsState.get();
  const base = type === 'measurements.set' ? [] : cur.items;
  const mapped = inputs.map(readMeasurement);
  // importJson replaces + backfills every optional field
  const n = measurementsActions.importJson(
    JSON.stringify({ items: [...base, ...mapped], muted: cur.muted, precision: cur.precision }),
  );
  return { added: Math.max(0, n - base.length) };
};

export const sceneHandlers: Record<string, ApiHandler> = {
  // `append: true` adds to the current selection instead of replacing it
  'selection.set': ({ p }) =>
    viewerActions.selectByFullnames(strings(p.fullnames, 'fullnames'), { append: p.append === true }),

  // Big selections: the fullname list rides in `bytes` (UTF-8, one per line)
  // and is packed straight into the model DB — no JS string per row, nothing
  // to clone back. Same `append` semantics as selection.set.
  'selection.setList': async ({ p, bytes }) => {
    const packed = packedFromBytes(await nameListBytes(bytes, 'selection.setList'));
    const r = await viewerActions.selectByPacked(packed, { append: p.append === true });
    return { names: packed.count, matched: r.matched, missed: r.missed };
  },

  'selection.clear': async () => {
    await viewerActions.clearSelection();
    return {};
  },

  'selection.get': async ({ p }) => {
    const pairs = selectionState
      .get()
      .actives.map((k) => k.split(':').map(Number))
      .filter((x) => x.length === 2)
      .map(([model, entry]) => ({ model, entry }));
    const skip = (p.skip === undefined ? [] : strings(p.skip, 'skip'))
      .map((x) => x.replace(/\*+$/, '').trim().toLowerCase())
      .filter((x) => x.length > 0);
    // every ancestor of a selected node, each once — the rows above the
    // selection; independent of `items` (uncapped, minus `skip` prefixes)
    const parents = p.parents === true ? { parents: await db.selectedNodeParents(skip) } : {};
    const base = { count: selectionState.get().count, fullnames: await db.entryNames(pairs), ...parents };
    if (p.items !== true) {
      return base;
    }
    // every selected NODE (grouping entries and leaves, children included) —
    // minus `skip` prefixes, capped, the true total in itemCount
    const maxItems = typeof p.maxItems === 'number' && p.maxItems > 0 ? Math.floor(p.maxItems) : 10_000;
    const { names, total, truncated } = await db.selectedNodeNames(maxItems, skip);
    return { ...base, items: names, itemCount: total, ...(truncated ? { truncated: true } : {}) };
  },

  'labels.set': setOrAddLabels,
  'labels.add': setOrAddLabels,

  // every label as the panel holds it: the labels.set fields plus id, style,
  // the dragged offset and the sphere marker
  'labels.get': () => ({
    labels: labelsState.get().items.map((l) => ({
      id: l.id,
      text: l.text,
      fullname: l.fullname,
      anchor: l.anchor,
      offset: l.offset,
      bg: l.bg,
      opacity: l.opacity,
      textColor: l.textColor,
      sphere: l.sphere ?? null,
      muted: l.muted === true,
    })),
  }),

  'labels.clear': () => {
    labelsActions.clearAll();
    return {};
  },

  'labels.implode': () => {
    labelsActions.implode();
    return {};
  },

  'labels.explode': () => {
    labelsActions.explode();
    return {};
  },

  'measurements.set': setOrAddMeasurements,
  'measurements.add': setOrAddMeasurements,

  'measurements.clear': () => {
    measurementsActions.clear();
    return {};
  },

  'viewpoints.get': () => ({ config: viewpointsActions.configJson() }),

  'viewpoints.set': ({ p }) => {
    if (!isRecord(p.config)) {
      throw new ApiError('bad-payload', 'config must be an object (the shape viewpoints.get returns)');
    }
    let loaded: number;
    try {
      loaded = viewpointsActions.replaceAll(p.config);
    } catch (e) {
      throw new ApiError('bad-payload', e instanceof Error ? e.message : String(e));
    }
    if (p.showViewer === true) {
      openViewpointViewerPanelRight();
    }
    return { loaded };
  },

  'viewpoints.setUrl': async ({ p, signal }) => {
    const url = typeof p.url === 'string' ? p.url : '';
    if (!url) {
      throw new ApiError('bad-payload', 'url is required');
    }
    let text: string;
    try {
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      text = await res.text();
    } catch (e) {
      throw new ApiError('download', `download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    let loaded: number;
    try {
      loaded = viewpointsActions.replaceAll(JSON.parse(text));
    } catch (e) {
      throw new ApiError('bad-payload', e instanceof Error ? e.message : String(e));
    }
    if (p.showViewer === true) {
      openViewpointViewerPanelRight();
    }
    return { loaded };
  },

  'viewpoints.addFromLabels': async ({ p }) => {
    const items = labelsState.get().items;
    let picked: SceneLabel[];
    if (p.ids === undefined && p.fullnames === undefined) {
      picked = items.filter((l) => l.selected);
    } else {
      const ids: unknown[] = Array.isArray(p.ids) ? p.ids : p.ids === undefined ? [] : [null];
      const names: unknown[] = Array.isArray(p.fullnames) ? p.fullnames : p.fullnames === undefined ? [] : [null];
      if (!ids.every((x) => typeof x === 'number')) {
        throw new ApiError('bad-payload', 'ids must be an array of label ids (numbers, from labels.get)');
      }
      if (!names.every((x) => typeof x === 'string')) {
        throw new ApiError('bad-payload', 'fullnames must be an array of strings');
      }
      const norm = (s: string) => s.trim().toLowerCase().replace(/^\//, '');
      const idSet = new Set(ids);
      const nameSet = new Set(names.map(norm));
      picked = items.filter((l) => idSet.has(l.id) || (l.fullname != null && nameSet.has(norm(l.fullname))));
    }
    const result = await viewpointsActions.addFromLabels(picked);
    if (p.showViewer === true) {
      openViewpointViewerPanelRight();
    }
    return result;
  },

  'viewpoints.setBookmarkButton': ({ p }) => {
    if (p.button === null) {
      viewpointsActions.setBookmarkButton(null);
      return { shown: false };
    }
    if (!isRecord(p.button) || typeof p.button.label !== 'string' || !p.button.label.trim()) {
      throw new ApiError('bad-payload', 'button must be null or { label, tooltip? } with a non-empty label');
    }
    viewpointsActions.setBookmarkButton({
      label: p.button.label.trim(),
      tooltip: typeof p.button.tooltip === 'string' ? p.button.tooltip : '',
    });
    return { shown: true };
  },
};
