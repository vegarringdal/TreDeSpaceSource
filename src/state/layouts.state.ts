// Named dock-layout slots (App Layout ribbon): 12 preset snapshot slots on
// F1-F12 plus 12 user slots (Config01-12) on CTRL+F1-F12, each optionally linked
// to a ribbon tab that gets focused when the slot applies.
// The DockManager itself lives in React (App.tsx registers accessors here).

import type { DockState, LayoutNode, TabsNode } from '@treDeSpaceUI/dockable';
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { settingsTabState } from '../components/panels/settings/settings.state';
import {
  animateWorkspace,
  assetsWorkspace,
  HOME_RIGHT_PANELS,
  presentWorkspace,
  sqlWorkspace,
  viewpointWorkspace,
  workspace,
} from '../lib/appLayout';
import { storageKey } from '../lib/storageKeys';

export interface LayoutSlot {
  /** Display name (the user slots are renamable in Settings → Layouts; the
   *  default slots F1-F12 keep theirs). */
  name: string;
  /** Saved dock snapshot, or null while the slot is empty. */
  layout: DockState | null;
  /** Ribbon panel id focused when this slot applies (null = leave as is).
   *  Fixed for the default slots (F1-F12); the user slots choose theirs. */
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

/** Preset slots (F1-F12) — the first section of the App Layout ribbon. */
export const LAYOUT_SLOTS = 12;
/** User slots (CTRL+F1-F12, Config01-12) — the second section; CTRL+F1 ships
 *  the Assets preset, CTRL+F2 the Present one, the rest are empty by default. */
export const USER_LAYOUT_SLOTS = 12;
export const TOTAL_LAYOUT_SLOTS = LAYOUT_SLOTS + USER_LAYOUT_SLOTS;

/** The key a slot index answers to, as shown next to its name: F1-F12, then
 *  CTRL+F1-F12 for the user slots. */
export function layoutSlotKeyLabel(i: number): string {
  return i < LAYOUT_SLOTS ? `F${i + 1}` : `CTRL+F${i - LAYOUT_SLOTS + 1}`;
}

interface LayoutsState {
  slots: LayoutSlot[];
  /** The single selected slot (Save targets it), or null. */
  selected: number | null;
}

const defaultSlots = (): LayoutSlot[] => {
  const slots: LayoutSlot[] = Array.from({ length: TOTAL_LAYOUT_SLOTS }, (_, i) => ({
    // the presets below overwrite 1-14; 15-24 stay Config03-12 for the user
    name:
      i < LAYOUT_SLOTS
        ? `layout${String(i + 1).padStart(3, '0')}`
        : `Config${String(i - LAYOUT_SLOTS + 1).padStart(2, '0')}`,
    layout: null,
    ribbon: null,
  }));
  // Slots 1–4: the base workspace, each linked to a ribbon and tuned for that
  // task (right panel swapped/closed). The rest stay empty for the user.
  slots[0] = { name: 'Home', layout: workspace('ribbonHome', HOME_RIGHT_PANELS), ribbon: 'ribbonHome' };
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
    layout: workspace('ribbonSelectionTransform', 'transformObjects', true),
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
  // F10: animation authoring (Animation ribbon, Timeline + Overlay Preview, Key + Overlay Editor + Set Color)
  slots[9] = { name: 'Animation', layout: animateWorkspace('ribbonAnimation'), ribbon: 'ribbonAnimation' };
  // F11: the viewpoint suite (Viewer, and the Viewpoint Editor + the three
  // viewpoint editors as one tab group on the right)
  slots[10] = { name: 'Viewpoint', layout: viewpointWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  // F12: the SQL workspace (reports | editor | viewport+table+console | detail)
  slots[11] = { name: 'SQL Editor', layout: sqlWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  // CTRL+F1 (the first user slot): the asset-management workspace
  // (Model Assets over SQL Assets | viewport+console | Import Manager | Export)
  slots[LAYOUT_SLOTS] = { name: 'Assets', layout: assetsWorkspace('ribbonHome'), ribbon: 'ribbonHome' };
  // CTRL+F2: presenting an animation (the viewport with the Player beside it)
  slots[LAYOUT_SLOTS + 1] = {
    name: 'Present',
    layout: presentWorkspace('ribbonAnimation'),
    ribbon: 'ribbonAnimation',
  };
  return slots;
};

/** The ribbon each default slot (F1-F12) opens. It is FIXED — only the user
 *  slots can link another ribbon — so a ribbon tab can name "its" F-key. */
const DEFAULT_SLOT_RIBBONS: readonly (string | null)[] = defaultSlots()
  .slice(0, LAYOUT_SLOTS)
  .map((slot) => slot.ribbon);

/** True for the default slots (F1-F12): their name and linked ribbon are
 *  fixed — only the saved panel arrangement and Ribbon Open / Closed change. */
export function isDefaultLayoutSlot(i: number): boolean {
  return i < LAYOUT_SLOTS;
}

/** The ribbon slot `i` opens when applied: the factory one for a default
 *  slot, whatever was stored (an older save, another instance), else the
 *  slot's own link. */
function linkedRibbon(i: number, slot: LayoutSlot): string | null {
  return isDefaultLayoutSlot(i) ? DEFAULT_SLOT_RIBBONS[i] : slot.ribbon;
}

/** The first default slot (F1-F12) that opens ribbon `ribbonId`, or null when
 *  none does — Home answers to F1 although F11 and F12 open it too. */
export function defaultSlotForRibbon(ribbonId: string): number | null {
  const i = DEFAULT_SLOT_RIBBONS.indexOf(ribbonId);

  return i < 0 ? null : i;
}

/** The hotkey id that selects and applies slot `i` (bindings.ts). */
export function layoutSlotHotkeyId(i: number): string {
  return `layout.slot${i + 1}`;
}

const KEY = storageKey('layouts');

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
      if (!sv?.custom) {
        return d;
      }
      const slot = { ...d, ...sv };

      // a default slot keeps its factory name and ribbon whatever was stored
      return { ...slot, name: isDefaultLayoutSlot(i) ? d.name : slot.name, ribbon: linkedRibbon(i, slot) };
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
// on the App Layout ribbon, so a raw snapshot would always record ribbonLayout as
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
      const ribbon = linkedRibbon(i, slot);
      if (ribbon) {
        dock.openRibbon(ribbon);
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

  /** The dock as it is now — panels, floating windows, the active ribbon
   *  and whether it is collapsed — plus the selected slot, to come back to
   *  with `restore` (null before the dock exists). */
  snapshot(): { state: DockState; selected: number | null } | null {
    return dock ? { state: dock.save(), selected: layoutsState.get().selected } : null;
  },

  /** Back to a `snapshot`. */
  restore(snap: { state: DockState; selected: number | null }) {
    if (!dock) {
      return;
    }
    dock.load(JSON.parse(JSON.stringify(snap.state)) as DockState);
    layoutsState.set({ selected: snap.selected });
  },

  /** Apply a fixed workspace preset (Animate / Present) without touching the
   *  slots — the slot selection is cleared, so Save cannot overwrite one. */
  applyWorkspace(state: DockState, ribbon: string | null, ribbonOpen = true) {
    if (!dock) {
      return;
    }
    layoutsState.set({ selected: null });
    dock.load(JSON.parse(JSON.stringify(state)) as DockState);
    if (ribbon) {
      dock.openRibbon(ribbon);
    }
    dock.setRibbonOpen(ribbonOpen);
  },

  /** Rename a USER slot. A default slot (F1-F12) keeps its name: no-op there. */
  rename(i: number, name: string) {
    if (isDefaultLayoutSlot(i)) {
      return;
    }
    layoutsState.set((s) => ({ slots: s.slots.map((slot, k) => (k === i ? { ...slot, name } : slot)) }));
  },

  /** Link a ribbon tab to a USER slot (null = don't touch the ribbon on
   *  apply). A default slot (F1-F12) keeps its own ribbon: no-op there. */
  setRibbon(i: number, ribbon: string | null) {
    if (isDefaultLayoutSlot(i)) {
      return;
    }
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
