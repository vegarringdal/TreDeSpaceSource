import { useSyncExternalStore } from 'react';

/**
 * A tiny global store — the pattern every *.state.ts file builds on.
 * No external lib: React's useSyncExternalStore does all the heavy lifting.
 *
 *   const ui = createStore({ sidebarOpen: false });
 *   ui.set({ sidebarOpen: !ui.get().sidebarOpen });   // flip a bool → every user re-renders
 *   const { sidebarOpen } = ui.use();                 // inside any component
 *
 * Works outside React too (plain DOM, three.js, timers): subscribe() directly.
 */
/** The store handle createStore returns — for code parameterized over a store
 *  instance (e.g. the Set Color editor bound to global vs viewpoint rules). */
export type Store<T extends object> = ReturnType<typeof createStore<T>>;

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  };

  return {
    get,
    subscribe,
    set(patch: Partial<T> | ((prev: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const changed = (Object.keys(p) as Array<keyof T>).some((k) => state[k] !== p[k]);
      if (!changed) {
        return;
      }
      state = { ...state, ...p };
      for (const fn of listeners) {
        fn();
      }
    },
    use(): T {
      // biome-ignore lint/correctness/useHookAtTopLevel: `use` is itself a hook — callers obey the rules of hooks.
      return useSyncExternalStore(subscribe, get);
    },
  };
}
