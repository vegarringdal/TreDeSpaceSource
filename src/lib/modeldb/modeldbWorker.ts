// Model database worker (comlink). Owns everything that loops over millions
// of entries: model parsing/packing, the hierarchy (parents, children CSR,
// name pool), and selection/color item state. The main thread only uploads
// the typed arrays this worker produces — GPU and React never block on us.
//
// Undo is PER-DOMAIN by design: TWO independent stacks and nothing else —
// STATE (color/opacity/visibility, owned by apiColor; apiVisibility pushes
// onto it) and TRANSFORMS (apiTransform). There is no global undo. Animation
// mode (apiAnimation) is not an edit: it borrows slots and restores them.
//
// This file is only the composition root: each domain lives in its own module
// (shared state in dbState/transformPool, indexes in hierarchyIndex/
// globalNameIndex, the API surface in the api* slices). The merged `api`
// object is the single Comlink surface — external code imports ONLY the types
// re-exported here.
import * as Comlink from 'comlink';
import { animationApi } from './apiAnimation';
import { colorApi } from './apiColor';
import { exportApi } from './apiExport';
import { modelsApi } from './apiModels';
import { selectionApi } from './apiSelection';
import { snapshotApi } from './apiSnapshot';
import { transformApi } from './apiTransform';
import { treeApi } from './apiTree';
import { visibilityApi } from './apiVisibility';

export type { AnimActorSpec, AnimEnterResult, AnimSlotBinding } from './apiAnimation';
export type { ExportGeom } from './apiExport';
export type { SnapshotApplyResult, SnapshotSaveOptions } from './apiSnapshot';
export type { ColorRuleSpec } from './colorRules';
export {
  HAS_COLOR_OVERRIDE,
  HAS_OPACITY_OVERRIDE,
  IS_HIDDEN,
  IS_SELECTED,
  OPACITY_SHIFT,
  type StateUpdate,
  type TreeNode,
} from './dbState';
export { ANIM_BAND_FIRST, ANIM_BAND_SIZE, TRANSFORM_POOL } from './transformPoolLayout';

const api = {
  ...modelsApi,
  ...treeApi,
  ...selectionApi,
  ...visibilityApi,
  ...colorApi,
  ...transformApi,
  ...exportApi,
  ...snapshotApi,
  ...animationApi,
};

export type ModelDbApi = typeof api;

Comlink.expose(api);
