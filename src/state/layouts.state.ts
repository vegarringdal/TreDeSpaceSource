// Named dock-layout slots (Layout ribbon): 12 snapshot slots on F1-F12, each
// optionally linked to a ribbon tab that gets focused when the slot applies.
// The DockManager itself lives in React (App.tsx registers accessors here).

import type { DockState, LayoutNode, TabsNode } from '@treDeSpaceUI/dockable';
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { settingsTabState } from '../components/panels/settings/settings.state';
import { assetsWorkspace, sqlWorkspace, viewpointWorkspace, workspace } from '../lib/appLayout';

export interface LayoutSlot {
  /** Display name (renamable in Settings → Layouts). */
  name: string;
  /** Saved dock snapshot, or null while the slot is empty. */
  layout: DockState | null;
  /** Ribbon panel id focused when this slot applies (null = leave as is). */
  ribbon: string | null;
  /** Whether the ribbon strip is expanded when this slot applies (default true
   *  = open). Undefined in old saves → treated as open. */
  ribbonOpen?: boolean;
  /** Settings panel vertical tab to open when this slot applies (if Settings is
   *  in the layout). Undefined = leave the tab as-is. */
  settingsTab?: string;
  /** True once the user has saved their OWN arrangement into this slot (Layout
   *  ribbon → Save). Drives the per-slot reset button's enabled state — a slot
   *  still at its factory preset (or empty) has nothing to reset. */
  custom?: boolean;
}

export const LAYOUT_SLOTS = 12;

interface LayoutsState {
  slots: LayoutSlot[];
  /** The single selected slot (Save targets it), or null. */
  selected: number | null;
}

const defaultSlots = (): LayoutSlot[] => {
  const slots: LayoutSlot[] = Array.from({ length: LAYOUT_SLOTS }, (_, i) => ({
    name: `layout${String(i + 1).padStart(3, '0')}`,
    layout: null,
    ribbon: null,
  }));
  // Slots 1–4: the base workspace, each linked to a ribbon and tuned for that
  // task (right panel swapped/closed). The rest stay empty for the user.
  slots[0] = { name: 'Home', layout: workspace('ribbonHome', 'settings'), ribbon: 'ribbonHome' };
  // slots 2–4 minimize the console (last arg) — task-focused workspaces
  slots[1] = {
    name: 'Clip Plane',
    layout: workspace('ribbonClippingPlane', null, true),
    ribbon: 'ribbonClippingPlane',
  };
  slots[2] = {
    name: 'Clip Box',
    layout: workspace('ribbonClippingBox', 'clipShapes', true),
    ribbon: 'ribbonClippingBox',
  };
  slots[3] = {
    name: 'Selection Color',
    layout: workspace('ribbonSelectionColor', 'multiColor', true),
    ribbon: 'ribbonSelectionColor',
  };
  slots[4] = {
    name: 'Transform',
    layout: workspace('ribbonSelectionTransform', null, true),
    ribbon: 'ribbonSelectionTransform',
  };
  slots[5] = {
    name: 'Measurements',
    layout: workspace('ribbonMeasurements', 'measurements', true),
    ribbon: 'ribbonMeasurements',
  };
  slots[6] = { name: 'External', layout: workspace('ribbonExternal', null, true), ribbon: 'ribbonExternal' };
  slots[7] = {
    name: 'Panels',
    layout: workspace('ribbonPanels', 'settings', true),
    ribbon: 'ribbonPanels',
    settingsTab: 'layouts',
  };
  slots[8] = { name: 'Pad', layout: workspace('ribbonPad', null, true), ribbon: 'ribbonPad' };
  // F10: the viewpoint suite (Viewpoints + the three viewpoint editors right)
  slots[9] = { name: 'Viewpoint', layout: viewpointWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  // F11: the SQL workspace (reports | editor | viewport+table+console | detail)
  slots[10] = { name: 'SQL Editor', layout: sqlWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  // F12: the asset-management workspace
  // (Model Assets | SQL Assets | viewport+console | Import Manager)
  slots[11] = { name: 'Assets', layout: assetsWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  return slots;
};

const KEY = 'layouts';

function load(): LayoutsState {
  const fallback: LayoutsState = { slots: defaultSlots(), selected: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return fallback;
    }
    const saved = JSON.parse(raw) as Partial<LayoutsState>;
    // Slots the user SAVED (custom) keep their arrangement; everything else
    // tracks the factory presets, so preset updates reach existing installs.
    const slots = defaultSlots().map((d, i) => {
      const sv = saved.slots?.[i];
      return sv?.custom ? { ...d, ...sv } : d;
    });
    return { slots, selected: typeof saved.selected === 'number' ? saved.selected : null };
  } catch {
    return fallback;
  }
}

export const layoutsState = createStore<LayoutsState>(load());

layoutsState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(layoutsState.get()));
  } catch {
    // storage full / unavailable — non-fatal
  }
});

// DockManager accessors — registered by App.tsx once the manager exists.
let dock: {
  save: () => DockState;
  load: (s: DockState) => void;
  openRibbon: (id: string) => void;
  setRibbonOpen: (open: boolean) => void;
} | null = null;

export function registerLayoutDock(fns: typeof dock) {
  dock = fns;
}

/** The 'top' ribbon tabs node inside a layout tree. */
function findTopTabs(node: LayoutNode): TabsNode | null {
  if (node.type === 'tabs') {
    return node.id === 'top' ? node : null;
  }
  for (const c of node.children) {
    const found = findTopTabs(c);
    if (found) {
      return found;
    }
  }
  return null;
}

// The last ribbon tab the user REALLY worked in. Clicking Save requires being
// on the Layout ribbon, so a raw snapshot would always record ribbonLayout as
// the active tab — App.tsx feeds every focus change here and we patch the
// remembered ribbon into the snapshot instead. Content-area tab groups need
// no such fix: their activePanel rides in the snapshot untouched.
let lastRibbon: string | null = null;
export function noteActiveRibbon(id: string | undefined) {
  if (id && id !== 'ribbonLayout') {
    lastRibbon = id;
  }
}
export { findTopTabs };

export const layoutsActions = {
  /** Select a slot AND apply its saved layout (+ linked ribbon) if it has one.
   *  An empty slot just becomes the Save target. */
  activate(i: number) {
    const slot = layoutsState.get().slots[i];
    if (!slot) {
      return;
    }
    layoutsState.set({ selected: i });
    if (slot.layout && dock) {
      dock.load(JSON.parse(JSON.stringify(slot.layout)) as DockState);
      if (slot.ribbon) {
        dock.openRibbon(slot.ribbon);
      }
      // default (undefined) = open
      dock.setRibbonOpen(slot.ribbonOpen !== false);
      if (slot.settingsTab) {
        settingsTabState.set({ tab: slot.settingsTab });
      }
    }
  },

  /** Save the CURRENT dock layout into the selected slot. The active ribbon
   *  recorded is the last one the user actually worked in — not the Layout
   *  ribbon they had to switch to for the Save click. */
  saveCurrent() {
    const { selected } = layoutsState.get();
    if (selected == null || !dock) {
      return;
    }
    const snapshot = dock.save();
    const top = findTopTabs(snapshot.root);
    if (top && top.activePanel === 'ribbonLayout' && lastRibbon) {
      top.activePanel = lastRibbon;
    }
    layoutsState.set((s) => ({
      slots: s.slots.map((slot, k) => (k === selected ? { ...slot, layout: snapshot, custom: true } : slot)),
    }));
  },

  rename(i: number, name: string) {
    layoutsState.set((s) => ({ slots: s.slots.map((slot, k) => (k === i ? { ...slot, name } : slot)) }));
  },

  /** Link a ribbon tab to a slot (null = don't touch the ribbon on apply). */
  setRibbon(i: number, ribbon: string | null) {
    layoutsState.set((s) => ({ slots: s.slots.map((slot, k) => (k === i ? { ...slot, ribbon } : slot)) }));
  },

  /** Whether this slot opens (true) or collapses (false) the ribbon on apply. */
  setRibbonOpen(i: number, ribbonOpen: boolean) {
    layoutsState.set((s) => ({ slots: s.slots.map((slot, k) => (k === i ? { ...slot, ribbonOpen } : slot)) }));
  },

  /** Reset a single slot to its factory default (name + layout + ribbon). */
  resetOne(i: number) {
    layoutsState.set((s) => ({ slots: s.slots.map((slot, k) => (k === i ? defaultSlots()[i] : slot)) }));
  },

  /** Clear every saved layout snapshot and restore the default slot names. */
  resetAll() {
    layoutsState.set({ slots: defaultSlots(), selected: null });
  },
};
