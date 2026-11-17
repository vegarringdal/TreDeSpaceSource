import { createStore } from '@treDeSpaceUI/lib/createStore';

/** Panel-only state of the Transform Objects panel, not saved. */
export interface TransformObjectsUiState {
  /** which rows are open (object id → open; absent = closed) */
  open: Record<string, boolean>;
  /** To animation takes a container's sub-objects along (else it goes
   *  alone, what rides on it left out) */
  withSubObjects: boolean;
}

export const transformObjectsUiState = createStore<TransformObjectsUiState>({ open: {}, withSubObjects: true });
