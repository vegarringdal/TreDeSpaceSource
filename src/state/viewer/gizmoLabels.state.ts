import { createStore } from '@treDeSpaceUI/lib/createStore';

/** User-configurable names for the view-cube faces; the letter buttons on the
 * clipping-box / transform ribbons derive from their first letters. */
export type GizmoFaceName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export const DEFAULT_GIZMO_LABELS: Record<GizmoFaceName, string> = {
  front: 'FRONT',
  back: 'BACK',
  left: 'LEFT',
  right: 'RIGHT',
  top: 'TOP',
  bottom: 'BOT',
};

/** Face names are capped to this many characters so every face fits the cube at
 *  ONE uniform text size (see ViewGizmo.faceFont). */
export const MAX_GIZMO_LABEL = 5;

/** Merge stored/partial face names over the defaults, each clamped to the
 *  MAX_GIZMO_LABEL cap. The single normaliser for load, set and cross-tab sync. */
export function mergeGizmoLabels(partial: Partial<Record<GizmoFaceName, string>>): Record<GizmoFaceName, string> {
  const out = { ...DEFAULT_GIZMO_LABELS };
  for (const face of Object.keys(DEFAULT_GIZMO_LABELS) as GizmoFaceName[]) {
    const v = partial?.[face];
    if (typeof v === 'string' && v.trim()) {
      out[face] = v.slice(0, MAX_GIZMO_LABEL);
    }
  }
  return out;
}

const KEY = 'gizmoLabels';

function load(): Record<GizmoFaceName, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return mergeGizmoLabels(JSON.parse(raw) as Partial<Record<GizmoFaceName, string>>);
    }
  } catch {
    // defaults
  }
  return { ...DEFAULT_GIZMO_LABELS };
}

export const gizmoLabelsState = createStore<{ labels: Record<GizmoFaceName, string> }>({
  labels: load(),
});

export const gizmoLabelsActions = {
  set(face: GizmoFaceName, value: string) {
    const clamped = value.slice(0, MAX_GIZMO_LABEL);
    const labels = { ...gizmoLabelsState.get().labels, [face]: clamped || DEFAULT_GIZMO_LABELS[face] };
    gizmoLabelsState.set({ labels });
    localStorage.setItem(KEY, JSON.stringify(labels));
  },
  reset() {
    gizmoLabelsState.set({ labels: { ...DEFAULT_GIZMO_LABELS } });
    localStorage.removeItem(KEY);
  },
};

/** Short button letters: first letter, extended with the second letter when
 * two faces would collide (e.g. BACK -> B, BOTTOM -> Bo). */
export function faceLetters(labels: Record<GizmoFaceName, string>): Record<GizmoFaceName, string> {
  const order: GizmoFaceName[] = ['left', 'right', 'front', 'back', 'bottom', 'top'];
  const used = new Set<string>();
  const out = {} as Record<GizmoFaceName, string>;
  for (const face of order) {
    const name = labels[face] || DEFAULT_GIZMO_LABELS[face];
    let letter = name[0].toUpperCase();
    if (used.has(letter)) {
      letter = letter + (name[1] ?? 'x').toLowerCase();
    }
    used.add(letter);
    out[face] = letter;
  }
  return out;
}
