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
import { getRenderer, viewerActions } from '../../state/viewer/viewer.actions';
import { viewpointsActions } from '../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../state/viewer/viewpoints.state';
import { packedFromBytes } from '../color/packedNames';
import {
  ApiError,
  type ApiHandler,
  boolOpt,
  colorOpt,
  isRecord,
  nameListBytes,
  numOpt,
  oneOf,
  records,
  strings,
  strOpt,
  vec2Opt,
  vec3,
} from './protocol';
import { getGpuState } from './transport';

/** Map key for a label anchor lookup: case-insensitive, leading '/' ignored —
 *  `findLabelAnchors` answers with the MODEL's real fullname, which may carry
 *  the slash the caller left out (or the other way round). */
const anchorKey = (name: string): string => name.trim().toLowerCase().replace(/^\//, '');

/** Label text for an entry that carries no `text`: the linked fullname, with
 *  its leading '/' dropped when asked. A point-anchored label has no name to
 *  fall back on, so it stays empty. */
function deriveLabelText(fullname: string | null, strip: unknown, fallbackStrip: boolean): string {
  if (fullname === null) {
    return '';
  }
  return boolOpt(strip, 'labels[].stripSlash', fallbackStrip) ? fullname.replace(/^\//, '') : fullname;
}

type LabelAnchors = {
  centers: Map<string, [number, number, number]>;
  notFound: string[];
};

/** Resolve tag names to world anchors. `snap` anchors on the nearest child
 *  item when the subtree's bounds centre hangs in empty air (bent pipe runs),
 *  so a batch mixing snapped and plain labels takes one lookup per group. */
async function resolveAnchors(names: string[], snap: boolean): Promise<LabelAnchors> {
  if (names.length === 0) {
    return { centers: new Map(), notFound: [] };
  }
  const { found, notFound } = await db.findLabelAnchors(names, snap);
  return { centers: new Map(found.map((f) => [anchorKey(f.name), f.center])), notFound };
}

const setOrAddLabels: ApiHandler = async ({ type, p }) => {
  const inputs = records(p.labels, 'labels');
  const s = labelsState.get();
  // `snap` is per label and defaults to the Labels panel's toggle, like the
  // style fields below — validated up front so a bad flag fails before the
  // (async) anchor lookups
  const wants = inputs.map((l, i) => ({
    l,
    what: `labels[${i}]`,
    snap: boolOpt(l.snap, `labels[${i}].snap`, s.snapToItem),
  }));
  const namesFor = (snap: boolean): string[] => [
    ...new Set(
      wants.filter((w) => w.snap === snap && typeof w.l.fullname === 'string').map((w) => String(w.l.fullname)),
    ),
  ];
  const [plain, snapped] = await Promise.all([
    resolveAnchors(namesFor(false), false),
    resolveAnchors(namesFor(true), true),
  ]);
  const items: SceneLabel[] = [];
  for (const { l, what, snap } of wants) {
    let anchor: [number, number, number] | null = null;
    let fullname: string | null = null;
    if (typeof l.fullname === 'string') {
      const c = (snap ? snapped : plain).centers.get(anchorKey(l.fullname));
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
      // no text: label a tag by name alone, like the panel's tag import —
      // `stripSlash` (panel toggle by default) drops the model's leading '/'
      // from what is SHOWN, never from the fullname the label links to. A text
      // the caller wrote is used exactly as given.
      text: typeof l.text === 'string' ? l.text : deriveLabelText(fullname, l.stripSlash, s.importStripSlash),
      fullname,
      anchor,
      // non-zero offset = the label sits away from its anchor, leader line drawn
      offset: vec2Opt(l.offset, `${what}.offset`, [0, 0]),
      selected: false,
      // style: each field falls back to the panel's, like `sphere` below
      bg: colorOpt(l.bg, `${what}.bg`, s.bg),
      opacity: numOpt(l.opacity, `${what}.opacity`, s.opacity, { min: 0, max: 1 }),
      textColor: colorOpt(l.textColor, `${what}.textColor`, s.textColor),
      // null = follow the panel's leader colour (also the label's border)
      leaderColor: colorOpt(l.leaderColor, `${what}.leaderColor`, null),
      // explicit marker (or `true` for the panel default); omitted = the panel style
      sphere: l.sphere === undefined ? s.sphere : readSphereMarker(l.sphere),
    });
  }
  const base = type === 'labels.set' ? [] : s.items;
  const combined = [...base, ...items].slice(0, MAX_LABELS);
  labelsActions.setAll(combined);
  return { added: items.length, missed: [...new Set([...plain.notFound, ...snapped.notFound])] };
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

const RENDERER_POLL_MS = 30;
const RENDERER_WAIT_MS = 30_000;

/** Wait for the viewport to register its renderer.
 *
 *  This flag is made for page load, and the viewport boots in PARALLEL with
 *  the API — `app.ready` normally reports `gpu: 'booting'` — so a host calling
 *  it as early as it can would otherwise activate against no renderer.
 *  `activate` reaches the camera through an optional chain, so that loses the
 *  pose in silence while labels, clipping, rules and selection all land: a
 *  viewpoint applied everywhere except the one part you can see. Waiting for
 *  the boot to resolve either way keeps that from happening. */
async function waitForRenderer(): Promise<void> {
  const until = performance.now() + RENDERER_WAIT_MS;
  while (!getRenderer() && getGpuState() === 'booting' && performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, RENDERER_POLL_MS));
  }
}

/** `activateFirst` on a viewpoint load: run the first viewpoint of the set
 *  that just landed, exactly as clicking it in the panel does — camera,
 *  clipping, labels, measurements, Set Color rules and selection. The load
 *  leaves the set merely SELECTED, so without this a host has to follow up
 *  with a click. Resolves false when off or the set is empty.
 *
 *  A viewport that failed to boot stops the wait rather than running it out,
 *  and the viewpoint still applies — there is simply no camera to move. */
async function activateFirstViewpoint(wanted: boolean): Promise<boolean> {
  const first = viewpointsState.get().list[0];
  if (!wanted || !first) {
    return false;
  }

  await waitForRenderer();
  await viewpointsActions.activate(first.id);
  return true;
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
      leaderColor: l.leaderColor ?? null,
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

  'viewpoints.set': async ({ p }) => {
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
    return { loaded, activated: await activateFirstViewpoint(p.activateFirst === true) };
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
    return { loaded, activated: await activateFirstViewpoint(p.activateFirst === true) };
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
