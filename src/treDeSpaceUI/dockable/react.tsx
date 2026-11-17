import { type ComponentType, createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DockManager } from './DockManager';
import type { DockManagerOptions, PanelContext, PanelDefinition, PanelRenderer } from './types';

/* -------------------------------------------------------------- panel content */

const Ctx = createContext<PanelContext | null>(null);

/** The dock context for the panel this component is rendered inside. */
export function usePanelContext(): PanelContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('usePanelContext must be called inside a React panel.');
  }
  return ctx;
}

/** True while this panel lives in a floating window. */
export function useIsFloating(manager: DockManager, panelId: string): boolean {
  useDockLayout(manager);
  return manager.isFloating(panelId);
}

/** Declare how small this panel's content may be squeezed, in px. */
export function useMinSize(width?: number, height?: number) {
  const ctx = usePanelContext();
  useEffect(() => {
    ctx.setMinSize({ width, height });
  }, [ctx, width, height]);
}

/** Rename the tab from inside the panel. */
export function usePanelTitle(title: string) {
  const ctx = usePanelContext();
  useEffect(() => {
    ctx.setTitle(title);
  }, [ctx, title]);
}

/**
 * Wrap a React component as panel content. The React root is created once and
 * survives docking, tab switching and re-splitting — the dock only reparents
 * the host element, it never re-creates it.
 */
export function reactPanel(Component: ComponentType<{ ctx: PanelContext }>): PanelRenderer {
  return (host, ctx) => {
    const root: Root = createRoot(host);
    root.render(
      <Ctx.Provider value={ctx}>
        <Component ctx={ctx} />
      </Ctx.Provider>,
    );
    return () => {
      // Unmounting during a React render pass is illegal; defer one tick.
      queueMicrotask(() => root.unmount());
    };
  };
}

/** Define a panel whose content is a React component. */
export function definePanel(
  def: Omit<PanelDefinition, 'render'> & { component: ComponentType<{ ctx: PanelContext }> },
): PanelDefinition {
  const { component, ...rest } = def;
  return { ...rest, render: reactPanel(component) };
}

/* ------------------------------------------------------------------- the dock */

/** Create a DockManager that lives for the lifetime of the component. */
export function useDockManager(makeOptions: () => DockManagerOptions): DockManager {
  const ref = useRef<DockManager | null>(null);
  if (ref.current === null) {
    ref.current = new DockManager(makeOptions());
  }
  return ref.current;
}

/**
 * Re-render the calling component whenever the layout changes — panels opening,
 * closing, moving, floating, resizing. Returns the version counter, which is a
 * stable snapshot (the tree itself is mutated in place during drags).
 */
export function useDockLayout(manager: DockManager): number {
  return useSyncExternalStore(
    useMemo(() => (cb: () => void) => manager.subscribe(cb), [manager]),
    () => manager.version,
  );
}

export { DockView } from './DockView';
export { PanelBody } from './PanelBody';
