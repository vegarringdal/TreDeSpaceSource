import { createStore } from '@treDeSpaceUI/lib/createStore';

/** UI-facing selection info; the authoritative item sets live in the worker. */
export interface SelectionState {
  /** items currently selected (sum over models) */
  count: number;
  /** last tree node that drove the selection (scroll anchor) */
  active: { model: number; entry: number } | null;
  /** all selection roots ("model:entry") — multi-select highlight */
  actives: string[];
  /** set instead of `active` when a whole folder group is selected */
  /** May be a store-QUALIFIED key (groupSelKey) when selected under a plant
   *  band — compare via groupSelKey, not raw path equality. */
  activeGroup: string | null;
  /** folder paths added to a MULTI-selection (ctrl/shift on folder rows) —
   *  keeps those folder rows highlighted alongside item actives */
  activeGroups: string[];
  /** set by picking: the tree should expand to and scroll to this path */
  reveal: { model: number; path: number[] } | null;
  /** bumped whenever models are added/removed so the tree reloads */
  modelsVersion: number;
  colorUndoDepth: number;
  colorRedoDepth: number;
  transformUndoDepth: number;
  transformRedoDepth: number;
  /** cached world AABB of the selection (drives the transform gizmo). */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export const selectionState = createStore<SelectionState>({
  count: 0,
  active: null,
  actives: [],
  activeGroup: null,
  activeGroups: [],
  reveal: null,
  modelsVersion: 0,
  colorUndoDepth: 0,
  colorRedoDepth: 0,
  transformUndoDepth: 0,
  transformRedoDepth: 0,
  bounds: null,
});

/** Store-qualified group key for activeGroup/activeGroups: a folder selected
 *  under a plant band scopes to that store; unqualified (no store) keys come
 *  from search/API picks and match the folder in EVERY store. */
export const groupSelKey = (group: string, store?: string | null): string => (store ? `${store}\0${group}` : group);
