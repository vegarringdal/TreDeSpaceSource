/** Built-in quick-pick swatches at the bottom of every color picker — 4 rows
 *  of 8. A host app can replace them with setColorSelectSwatchesStore(). */
export const DEFAULT_PICKER_SWATCHES = [
  '#ffffff',
  '#c9cfd8',
  '#7c8595',
  '#3a4250',
  '#f2726f',
  '#f0a831',
  '#f7e018',
  '#31f03a',
  '#3fb950',
  '#31e8f0',
  '#58a6ff',
  '#4a6df0',
  '#b544f0',
  '#f78ae0',
  '#b5651d',
  '#14161a',
  '#8b0000',
  '#ff4500',
  '#ff8800',
  '#ffd700',
  '#9acd32',
  '#228b22',
  '#008b8b',
  '#4682b4',
  '#1e3a8a',
  '#6a0dad',
  '#c71585',
  '#8b4513',
  '#d2b48c',
  '#708090',
  '#e5e7eb',
  '#000000',
];

/** Minimal live-store contract for the default swatch grid (createStore
 *  instances satisfy it structurally). */
export interface ColorSelectSwatchesStore {
  get(): { colors: string[] };
  /** Returns the unsubscriber. */
  subscribe(cb: () => void): () => void;
}

// Injected once by the host app at startup. Module-level (not React context)
// on purpose: the dockable shell mounts panels in separate React roots, which
// a context provider cannot reach.
let swatchesStore: ColorSelectSwatchesStore | null = null;

/** Host app: register a live store whose `colors` become every picker's
 *  default swatch grid (each `swatches` prop still wins). */
export function setColorSelectSwatchesStore(store: ColorSelectSwatchesStore | null) {
  swatchesStore = store;
}

// stable identities so useSyncExternalStore doesn't resubscribe every render
export const subscribeSwatches = (cb: () => void) => (swatchesStore ? swatchesStore.subscribe(cb) : () => {});
export const getSwatches = () => (swatchesStore ? swatchesStore.get().colors : DEFAULT_PICKER_SWATCHES);
