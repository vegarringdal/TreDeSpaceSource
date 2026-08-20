import { type DockState, useDockLayout, usePanelContext } from '@treDeSpaceUI/dockable';
import { useState } from 'react';

/**
 * Lives in a locked node: fixed height, no tab strip, immovable. It reads the
 * dock's own state via useDockLayout, which re-renders it whenever panels open,
 * close, move or float.
 */
export function Toolbar() {
  const { manager } = usePanelContext();
  useDockLayout(manager);
  const [saved, setSaved] = useState<DockState | null>(null);
  const closed = manager.closedPanels();

  return (
    <div className="toolbar">
      <strong className="brand">Dockable Studio</strong>
      <span className="dim">
        {manager.openPanels().length} panels · {manager.windows.length} windows
      </span>
      <span className="grow" />

      {closed.map((p) => (
        <button type="button" key={p.id} className="btn" onClick={() => manager.openPanel(p.id)}>
          Open {p.title}
        </button>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => manager.floatPanel('inspector', { width: 340, height: 420 })}
      >
        Float inspector
      </button>
      <button type="button" className="btn" onClick={() => manager.toggleCollapse('bottom')}>
        {manager.isCollapsed('bottom') ? 'Expand' : 'Collapse'} console
      </button>
      <button
        type="button"
        className="btn"
        title="Collapse the side panels — the viewport takes everything"
        onClick={() => {
          const focus = !manager.isCollapsed('left-top');
          for (const id of ['left-top', 'left-bottom', 'right', 'bottom']) {
            manager.setCollapsed(id, focus);
          }
        }}
      >
        Focus mode
      </button>
      <button type="button" className="btn" onClick={() => setSaved(manager.saveLayout())}>
        Save layout
      </button>
      <button type="button" className="btn" disabled={!saved} onClick={() => saved && manager.loadLayout(saved)}>
        Restore
      </button>
    </div>
  );
}
