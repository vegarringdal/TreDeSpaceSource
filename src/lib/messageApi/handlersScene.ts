// Scene-annotation commands: selection, labels (content + layout) and
// measurements. See EVENTS.md for the payload contracts.

import { openViewpointViewerPanelRight } from '../../components/panels/viewpoints/viewpointsPanel';
import { db } from '../../state/viewer/db';
import { labelsActions } from '../../state/viewer/labels.actions';
import { labelsState, MAX_LABELS, type SceneLabel } from '../../state/viewer/labels.state';
import { measurementsActions } from '../../state/viewer/measurements.actions';
import { measurementsState } from '../../state/viewer/measurements.state';
import { selectionState } from '../../state/viewer/selection.state';
import { viewerActions } from '../../state/viewer/viewer.actions';
import { viewpointsActions } from '../../state/viewer/viewpoints.actions';
import { packedFromBytes } from '../color/packedNames';
import { ApiError, type ApiHandler, isRecord, nameListBytes, records, strings } from './protocol';

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
    });
  }
  const base = type === 'labels.set' ? [] : s.items;
  const combined = [...base, ...items].slice(0, MAX_LABELS);
  labelsActions.setAll(combined);
  return { added: items.length, missed: notFound };
};

const setOrAddMeasurements: ApiHandler = ({ type, p }) => {
  const inputs = records(p.measurements, 'measurements');
  const cur = measurementsState.get();
  const base = type === 'measurements.set' ? [] : cur.items;
  const mapped = inputs.map((m, i) => ({ id: i + 1, ...m }));
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
    const base = { count: selectionState.get().count, fullnames: await db.entryNames(pairs) };
    if (p.items !== true) {
      return base;
    }
    // every selected NODE (grouping entries and leaves, children included) —
    // minus `skip` prefixes, capped, the true total in itemCount
    const maxItems = typeof p.maxItems === 'number' && p.maxItems > 0 ? Math.floor(p.maxItems) : 10_000;
    const skip = (p.skip === undefined ? [] : strings(p.skip, 'skip'))
      .map((x) => x.replace(/\*+$/, '').trim().toLowerCase())
      .filter((x) => x.length > 0);
    const { names, total, truncated } = await db.selectedNodeNames(maxItems, skip);
    return { ...base, items: names, itemCount: total, ...(truncated ? { truncated: true } : {}) };
  },

  'labels.set': setOrAddLabels,
  'labels.add': setOrAddLabels,

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

  'viewpoints.setUrl': async ({ p }) => {
    const url = typeof p.url === 'string' ? p.url : '';
    if (!url) {
      throw new ApiError('bad-payload', 'url is required');
    }
    let text: string;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      text = await res.text();
    } catch (e) {
      throw new ApiError('internal', `download failed: ${e instanceof Error ? e.message : String(e)}`);
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
