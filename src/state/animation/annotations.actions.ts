// The Labels and Measurements rows (DESIGN.md › Animation › Authoring): the
// animation shows its own label and measurement sets — fixed points in the
// model, a key's set from its time on, none before the first key. Entering
// animation mode puts the user's own sets aside (exact, ids kept) and leaving
// puts them back. While authoring the normal Label panel and measuring tools
// edit what is on screen: with the key in force picked, edits go into it;
// otherwise they wait for Key on the row (a moved time slider that brings
// another key drops them). No label undo entries are made.

import { toast } from '@treDeSpaceUI/widgets';
import { keyAt, labelsForKey, labelsText, measurementsText } from '../../lib/animation/annotations';
import type { FrameState } from '../../lib/animation/evaluate';
import { keyIndexNear, upsertKey } from '../../lib/animation/keyRows';
import type { LabelsKey, MeasurementsKey, Scene } from '../../lib/animation/types';
import { labelsActions } from '../viewer/labels.actions';
import { labelsState, type SceneLabel } from '../viewer/labels.state';
import { measurementsActions } from '../viewer/measurements.actions';
import { type Measurement, measurementsState } from '../viewer/measurements.state';
import { animationDocActions } from './animationDoc.actions';
import { animationUiState } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { keysActions } from './keys.actions';
import { liveTimeNow, setAnnotationsHandler } from './runtime';

// -----------------------------------------------------------------------------
// types + module state
// -----------------------------------------------------------------------------

/** Which row: the Labels or the Measurements. */
export type AnnotationKind = 'labels' | 'measurements';

type Stash = Readonly<{
  labels: SceneLabel[];
  labelsMuted: boolean;
  measurements: Measurement[];
  measurementsMuted: boolean;
}>;

/** The user's own sets while the animation shows its own (null: not
 *  animating). */
let stash: Stash | null = null;
/** what the animation last put on screen, as it compares */
let shownLabels = '';
let shownMeasurements = '';
/** the frame's keys last shown (undefined = show again) */
let lastLabels: LabelsKey | null | undefined;
let lastMeasurements: MeasurementsKey | null | undefined;
let offs: (() => void)[] = [];

const ROW = { labels: '@labels', measurements: '@measurements' } as const;
const NAME = { labels: 'Label', measurements: 'Measurement' } as const;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function showLabels(items: readonly SceneLabel[]): void {
  shownLabels = labelsText(items);
  labelsActions.replaceQuiet(structuredClone([...items]));
}

function showMeasurements(items: readonly Measurement[]): void {
  shownMeasurements = measurementsText(items);
  measurementsActions.replaceQuiet(structuredClone([...items]));
}

/** Edits on screen that were never keyed: dropped with a hint. */
function dropPending(kind: AnnotationKind): void {
  const flag = kind === 'labels' ? 'previewLabels' : 'previewMeasurements';
  if (animationUiState.get()[flag]) {
    animationUiState.set({ [flag]: false });
    toast.info(`${NAME[kind]} changes were not keyed, so they were dropped — press Key on the row first.`);
  }
}

/** The runtime's frame handler: each row's set on screen when the key in
 *  force changed (not when the screen already shows it — an edit that went
 *  into the key). */
function onFrame(frame: FrameState): void {
  if (frame.labels !== lastLabels) {
    lastLabels = frame.labels;
    const items = frame.labels?.labels ?? [];
    if (labelsText(items) !== labelsText(labelsState.get().items)) {
      dropPending('labels');
      showLabels(items);
    } else {
      shownLabels = labelsText(items);
    }
  }
  if (frame.measurements !== lastMeasurements) {
    lastMeasurements = frame.measurements;
    const items = frame.measurements?.measurements ?? [];
    if (measurementsText(items) !== measurementsText(measurementsState.get().items)) {
      dropPending('measurements');
      showMeasurements(items);
    } else {
      shownMeasurements = measurementsText(items);
    }
  }
}

/** The index of the row's picked key when it is the one in force, else null. */
function editedKey(kind: AnnotationKind, s: Scene): number | null {
  const p = animationUiState.get().picked;
  const i = p.kind === 'keys' && p.row === ROW[kind] ? p.indices[0] : undefined;
  const keys = kind === 'labels' ? s.labels : s.measurements;
  const k = i !== undefined ? keys[i] : undefined;
  return k && keyAt<{ t: number }>(keys, liveTimeNow()) === k ? (i ?? null) : null;
}

/** An edit on screen: into the picked key in force, else waiting for Key. */
function onEdit(kind: AnnotationKind): void {
  const text =
    kind === 'labels' ? labelsText(labelsState.get().items) : measurementsText(measurementsState.get().items);
  if (text === (kind === 'labels' ? shownLabels : shownMeasurements)) {
    animationUiState.set(kind === 'labels' ? { previewLabels: false } : { previewMeasurements: false });
    return;
  }
  const s = activeScene();
  const i = s ? editedKey(kind, s) : null;
  if (i === null) {
    animationUiState.set(kind === 'labels' ? { previewLabels: true } : { previewMeasurements: true });
    return;
  }
  if (kind === 'labels') {
    shownLabels = text;
    const labels = labelsForKey(labelsState.get().items);
    animationDocActions.commit(
      (d) => mapActiveScene(d, (sc) => ({ ...sc, labels: sc.labels.map((k, j) => (j === i ? { ...k, labels } : k)) })),
      `labels-edit:${i}`,
    );
    return;
  }
  shownMeasurements = text;
  const measurements = structuredClone(measurementsState.get().items);
  animationDocActions.commit(
    (d) =>
      mapActiveScene(d, (sc) => ({
        ...sc,
        measurements: sc.measurements.map((k, j) => (j === i ? { ...k, measurements } : k)),
      })),
    `measurements-edit:${i}`,
  );
}

/** The set in force at the time slider on screen now. */
function showInForce(): void {
  const s = activeScene();
  const T = liveTimeNow();
  lastLabels = s ? keyAt(s.labels, T) : null;
  lastMeasurements = s ? keyAt(s.measurements, T) : null;
  showLabels(lastLabels?.labels ?? []);
  showMeasurements(lastMeasurements?.measurements ?? []);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const annotationsActions = {
  /** Animation mode on (`editing` while authoring) or off — the user's own
   *  sets are put aside once and come back when the mode ends. */
  install(on: boolean, editing = false): void {
    for (const off of offs) {
      off();
    }
    offs = [];
    if (!on) {
      setAnnotationsHandler(null);
      if (stash) {
        labelsActions.replaceQuiet(stash.labels, true);
        labelsState.set({ muted: stash.labelsMuted });
        measurementsActions.replaceQuiet(stash.measurements);
        measurementsState.set({ muted: stash.measurementsMuted });
        stash = null;
      }
      animationUiState.set({ previewLabels: false, previewMeasurements: false });
      return;
    }
    if (!stash) {
      const l = labelsState.get();
      const m = measurementsState.get();
      stash = {
        labels: structuredClone(l.items),
        labelsMuted: l.muted,
        measurements: structuredClone(m.items),
        measurementsMuted: m.muted,
      };
      labelsState.set({ muted: false });
      measurementsState.set({ muted: false });
      showInForce();
    }
    setAnnotationsHandler(onFrame);
    if (editing) {
      offs = [labelsState.subscribe(() => onEdit('labels')), measurementsState.subscribe(() => onEdit('measurements'))];
    }
  },

  /** Key (I) on the row: what is on screen as a key at the time slider,
   *  then picked. */
  key(kind: AnnotationKind): void {
    const T = liveTimeNow();
    if (kind === 'labels') {
      const key: LabelsKey = { t: T, labels: labelsForKey(labelsState.get().items) };
      animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, labels: upsertKey(s.labels, key) })));
      shownLabels = labelsText(key.labels);
      animationUiState.set({ previewLabels: false });
    } else {
      const key: MeasurementsKey = { t: T, measurements: structuredClone(measurementsState.get().items) };
      animationDocActions.commit((d) =>
        mapActiveScene(d, (s) => ({ ...s, measurements: upsertKey(s.measurements, key) })),
      );
      shownMeasurements = measurementsText(key.measurements);
      animationUiState.set({ previewMeasurements: false });
    }
    const s = activeScene();
    const i = keyIndexNear(kind === 'labels' ? (s?.labels ?? []) : (s?.measurements ?? []), T);
    if (i >= 0) {
      keysActions.pickKeys(ROW[kind], [i]);
    }
  },

  /** None from the time slider on: a key with an empty set. */
  none(kind: AnnotationKind): void {
    if (kind === 'labels') {
      showLabels([]);
    } else {
      showMeasurements([]);
    }
    annotationsActions.key(kind);
  },

  /** The user's own set (put aside when the mode started) on screen — Key
   *  keys it (or it goes into the picked key in force). */
  fromScene(kind: AnnotationKind): void {
    if (!stash) {
      return;
    }
    const items = kind === 'labels' ? stash.labels : stash.measurements;
    if (items.length === 0) {
      toast.info(`There are no ${kind} in the scene to bring in.`);
      return;
    }
    if (kind === 'labels') {
      labelsActions.replaceQuiet(structuredClone(stash.labels));
    } else {
      measurementsActions.replaceQuiet(structuredClone(stash.measurements));
    }
  },

  /** Show / hide one label (its mute) or measurement on screen. */
  toggle(kind: AnnotationKind, id: number): void {
    if (kind === 'labels') {
      labelsState.set((s) => ({
        items: s.items.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l)),
        version: s.version + 1,
      }));
      return;
    }
    measurementsState.set((s) => ({ items: s.items.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)) }));
  },

  /** The user's own sets were put aside: how many of each. */
  sceneCounts(): { labels: number; measurements: number } {
    return { labels: stash?.labels.length ?? 0, measurements: stash?.measurements.length ?? 0 };
  },
};
