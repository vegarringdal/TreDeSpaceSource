import { useLayoutEffect, useRef } from 'react';
import type { DockManager } from './DockManager';

/** Mounts the dock into the DOM. Everything inside is managed by lit-html. */
export function DockView({ manager, className }: { manager: DockManager; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    manager.mount(el);
    return () => manager.unmount();
  }, [manager]);

  return <div ref={ref} className={className} />;
}
