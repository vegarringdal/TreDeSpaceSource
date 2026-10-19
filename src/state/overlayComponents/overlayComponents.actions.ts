// Overlay library mutations + OPFS persistence (DESIGN.md › Animation
// › Overlays). Saving a component bumps its version; animation files embed the
// components they use, and a load with a different version asks which copy
// wins (animationDoc.actions resolves the conflict).

import { dialogs } from '../../components/dialogs/dialogs.actions';
import { settingsState } from '../../components/panels/settings/settings.state';
import { OVERLAY_LIBRARY_FILE, readJson, rootDir, writeJson } from '../../lib/opfs/opfs';
import { type OverlayBundle, sameOverlay } from '../../lib/overlay/overlayFile';
import { component as parseComponent, theme as parseTheme } from '../../lib/overlay/overlayParse';
import { autoTheme, OVERLAY_PRESETS, OVERLAY_THEME_PRESETS } from '../../lib/overlay/overlayPresets';
import type { OverlayComponent, OverlayTheme } from '../../lib/overlay/overlayTypes';
import { overlayLibraryState } from './overlayComponents.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

interface LibraryFile {
  version: 1;
  components: unknown[];
  themes: unknown[];
}

/** What an import did. */
export interface ImportReport {
  added: number;
  replaced: number;
  /** different from yours under the same id, and you kept yours */
  kept: number;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Saved entries replace presets with the same id; unknown/invalid ones are
 *  dropped quietly (a corrupt library must not block the tool). */
function merge<T extends { id: string }>(
  presets: readonly T[],
  saved: unknown[],
  parse: (v: unknown, p: string) => T,
): T[] {
  const byId = new Map(presets.map((p) => [p.id, p]));
  saved.forEach((raw, i) => {
    try {
      const v = parse(raw, `library[${i}]`);
      byId.set(v.id, v);
    } catch {
      // skip the broken entry
    }
  });
  return [...byId.values()];
}

let saveTimer = 0;

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void overlayLibraryActions.persist(), 400);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const overlayLibraryActions = {
  /** Load the OPFS library once (idempotent). */
  async load(): Promise<void> {
    if (overlayLibraryState.get().loaded) {
      return;
    }
    let file: LibraryFile | null = null;
    try {
      file = await readJson<LibraryFile>(await rootDir(), OVERLAY_LIBRARY_FILE);
    } catch {
      file = null;
    }
    overlayLibraryState.set({
      components: merge(OVERLAY_PRESETS, Array.isArray(file?.components) ? file.components : [], parseComponent),
      // built-in themes keep their own names (saved copies may carry old ones)
      themes: merge(OVERLAY_THEME_PRESETS, Array.isArray(file?.themes) ? file.themes : [], parseTheme).map((t) => {
        const preset = OVERLAY_THEME_PRESETS.find((p) => p.id === t.id);
        return preset ? { ...t, name: preset.name } : t;
      }),
      loaded: true,
    });
  },

  async persist(): Promise<void> {
    const s = overlayLibraryState.get();
    try {
      await writeJson(await rootDir(), OVERLAY_LIBRARY_FILE, {
        version: 1,
        components: s.components,
        themes: s.themes,
      });
    } catch {
      // OPFS unavailable (private window) — the library lives for the session
    }
  },

  /** Save a component (new or edited); the version is bumped on every save. */
  saveComponent(c: OverlayComponent): OverlayComponent {
    const list = overlayLibraryState.get().components;
    const prev = list.find((x) => x.id === c.id);
    const saved = { ...c, version: Math.max(c.version, prev?.version ?? 0) + (prev ? 1 : 0) };
    overlayLibraryState.set({ components: prev ? list.map((x) => (x.id === c.id ? saved : x)) : [...list, saved] });
    scheduleSave();
    return saved;
  },

  /** Adopt a component exactly as given (a doc's embedded copy, "use file's"). */
  adoptComponent(c: OverlayComponent): void {
    const list = overlayLibraryState.get().components;
    overlayLibraryState.set({
      components: list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c],
    });
    scheduleSave();
  },

  removeComponent(id: string): void {
    overlayLibraryState.set({ components: overlayLibraryState.get().components.filter((c) => c.id !== id) });
    scheduleSave();
  },

  saveTheme(t: OverlayTheme): void {
    const list = overlayLibraryState.get().themes;
    overlayLibraryState.set({
      themes: list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t],
    });
    scheduleSave();
  },

  /** Add a file's designs and themes (an overlay or plan file). New ones
   *  join; one that differs from yours under the same id replaces yours only
   *  when the user says so — one question for all of them (`interactive` off:
   *  yours are kept). A replaced design's version moves past both. */
  async importBundle(b: OverlayBundle, source: string, interactive = true): Promise<ImportReport> {
    await overlayLibraryActions.load();
    const lib = overlayLibraryState.get();
    const myC = new Map(lib.components.map((c) => [c.id, c]));
    const myT = new Map(lib.themes.map((t) => [t.id, t]));
    const newC = b.components.filter((c) => !myC.has(c.id));
    const newT = b.themes.filter((t) => !myT.has(t.id));
    const diffC = b.components.filter((c) => {
      const mine = myC.get(c.id);
      return mine !== undefined && !sameOverlay(mine, c);
    });
    const diffT = b.themes.filter((t) => {
      const mine = myT.get(t.id);
      return mine !== undefined && !sameOverlay(mine, t);
    });
    const names = [...diffC, ...diffT].map((x) => `"${x.name || x.id}"`);
    const useFile =
      names.length > 0 &&
      interactive &&
      (await dialogs.confirm(
        `${source} has ${names.length} design(s) or theme(s) with the id of one of yours but made differently: ` +
          `${names.join(', ')}. Use the file's? Cancel keeps yours.`,
        { title: 'Overlay designs', okLabel: "Use the file's", cancelLabel: 'Keep mine' },
      ));
    for (const c of newC) {
      overlayLibraryActions.adoptComponent(c);
    }
    for (const t of [...newT, ...(useFile ? diffT : [])]) {
      overlayLibraryActions.saveTheme(t);
    }
    if (useFile) {
      for (const c of diffC) {
        overlayLibraryActions.saveComponent(c);
      }
    }
    return {
      added: newC.length + newT.length,
      replaced: useFile ? names.length : 0,
      kept: useFile ? 0 : names.length,
    };
  },

  removeTheme(id: string): void {
    overlayLibraryState.set({ themes: overlayLibraryState.get().themes.filter((t) => t.id !== id) });
    scheduleSave();
  },
};

/** A library component by id. */
export function libraryComponent(id: string): OverlayComponent | null {
  return overlayLibraryState.get().components.find((c) => c.id === id) ?? null;
}

/** A library theme by id. */
export function libraryTheme(id: string): OverlayTheme | null {
  return overlayLibraryState.get().themes.find((t) => t.id === id) ?? null;
}

/** The theme Auto means now: Light or Dark after the app's theme. */
export function appAutoTheme(): OverlayTheme {
  return autoTheme(settingsState.get().theme, overlayLibraryState.get().themes);
}
