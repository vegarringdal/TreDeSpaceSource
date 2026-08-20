import { hotkeysActions } from '@treDeSpaceUI/hotkeys';
import { gizmoLabelsActions } from '../../../state/viewer/gizmoLabels.state';
import { navActions } from '../../../state/viewer/nav.state';
import { initialViewerState, viewerState } from '../../../state/viewer/viewer.state';
import { consoleActions } from '../console/console.actions';
import { SETTINGS_DEFAULTS, type SettingsState, settingsState } from './settings.state';

/** Push the current theme to the DOM without logging — App calls this once at startup. */
export function initTheme() {
  const { theme } = settingsState.get();
  if (theme === 'dark') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export const settingsActions = {
  /** Theme = a data-theme attribute; styles.css maps it to CSS variables. */
  setGpu(gpu: SettingsState['gpu']) {
    settingsState.set({ gpu });
  },

  setTheme(theme: SettingsState['theme']) {
    settingsState.set({ theme });
    if (theme === 'dark') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    consoleActions.log('info', `Theme → ${theme}`);
  },
  toggleTheme() {
    settingsActions.setTheme(settingsState.get().theme === 'dark' ? 'light' : 'dark');
  },
  setAutosave(autosave: string) {
    settingsState.set({ autosave });
  },
  setModules(modules: string[]) {
    settingsState.set({ modules });
  },
  setSnap(snap: string) {
    settingsState.set({ snap });
  },
  /** Reset every settings tab EXCEPT Layout slots and External apps: rendering,
   *  lighting, GPU, navigation, edges, AO, gizmo, stats, editor, theme, and the
   *  custom keyboard shortcuts. Layout and External have their own reset buttons
   *  (they hold user content, not preferences, so a defaults reset leaves them). */
  resetAll() {
    viewerState.set(initialViewerState); // rendering/lighting/edges/AO/culling/picking/outline/debug/stats
    navActions.reset(); // navigation
    gizmoLabelsActions.reset(); // gizmo face labels
    hotkeysActions.resetAll(); // custom keyboard shortcuts
    settingsState.set({ ...SETTINGS_DEFAULTS }); // theme + GPU pref + editor (autosave/modules/snap)
    initTheme(); // push the default theme to the DOM
    consoleActions.log('info', 'Settings → reset all to defaults (Layout & External left as-is)');
  },
};
