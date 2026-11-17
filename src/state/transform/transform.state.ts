import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { TransformObject } from '../../lib/transform/types';

/** What the worker found for one object's names. */
export interface TransformObjectInfo {
  /** live items the names resolve to (those of objects inside it included) */
  items: number;
  /** names no loaded model has */
  missing: number;
  /** its items' box where the model has them [minx..maxz]; null: none loaded */
  restBox: number[] | null;
}

/** The transform objects (DESIGN.md › Transform objects): what the Transform
 *  ribbon moves, and how far each stands from where the model has it. */
export interface TransformState {
  objects: TransformObject[];
  /** the object the selection is — what the ribbon and the gizmo move; set
   *  from the selection only (transformSync) */
  currentId: string | null;
  /** the object that was current last — what Add / Remove selection act on
   *  once the selection has moved on to the items to add or leave out */
  lastCurrentId: string | null;
  /** by object id; filled in by the worker after every change of items */
  info: Record<string, TransformObjectInfo>;
  undoDepth: number;
  redoDepth: number;
}

export const transformState = createStore<TransformState>({
  objects: [],
  currentId: null,
  lastCurrentId: null,
  info: {},
  undoDepth: 0,
  redoDepth: 0,
});
