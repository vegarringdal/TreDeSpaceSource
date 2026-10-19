// Overlay files from the Overlay Editor (DESIGN.md › Animation › Overlays):
// export the open design, or all of yours with your themes, as a
// *.tdoverlay.json; import one into the library (a design that differs from
// yours under the same id is replaced only when the user says so).

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { downloadText } from '../../lib/download';
import {
  isBuiltInOverlay,
  OVERLAY_FILE_EXT,
  parseOverlayFile,
  serializeOverlayFile,
} from '../../lib/overlay/overlayFile';
import { pickTextFile } from '../../lib/pickFile';
import { overlayEditorState } from '../animation/overlayEditor.state';
import { type ImportReport, overlayLibraryActions } from './overlayComponents.actions';
import { overlayLibraryState } from './overlayComponents.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const ALL_NAME = 'overlay-designs';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** A file name from a design's name. */
function fileName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-');
  return `${slug || 'overlay'}${OVERLAY_FILE_EXT}`;
}

/** "2 added, 1 replaced" for a toast. */
export function importSummary(r: ImportReport): string {
  const parts = [
    r.added > 0 ? `${r.added} added` : '',
    r.replaced > 0 ? `${r.replaced} replaced` : '',
    r.kept > 0 ? `${r.kept} kept as yours` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'all already in your library';
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const overlayFileActions = {
  /** Download the design open in the Overlay Editor (as shown, saved or not). */
  exportOpen(): void {
    const w = overlayEditorState.get().working;
    if (!w) {
      toast.info('Open a design in the Overlay Editor first.');
      return;
    }
    if (isBuiltInOverlay(w.id)) {
      toast.info(`"${w.name}" is built in — make your own copy (New ▾ → Copy) to export it.`);
      return;
    }
    downloadText(fileName(w.name), serializeOverlayFile({ components: [w], themes: [] }));
  },

  /** Download all your own designs and themes as one file. */
  exportAll(): void {
    const lib = overlayLibraryState.get();
    const components = lib.components.filter((c) => !isBuiltInOverlay(c.id));
    const themes = lib.themes.filter((t) => !isBuiltInOverlay(t.id));
    if (components.length === 0 && themes.length === 0) {
      toast.info('You have no designs or themes of your own yet.');
      return;
    }
    downloadText(`${ALL_NAME}${OVERLAY_FILE_EXT}`, serializeOverlayFile({ components, themes }));
  },

  /** Pick an overlay file and add its designs and themes to the library. */
  async importFile(): Promise<void> {
    const file = await pickTextFile(`application/json,.json,${OVERLAY_FILE_EXT}`);
    if (!file) {
      return;
    }
    const parsed = parseOverlayFile(file.text);
    if (parsed.error || !parsed.data) {
      dialogs.error(`${file.name}:\n${parsed.error?.msg ?? 'not an overlay file'}`, 'Import designs');
      return;
    }
    const report = await overlayLibraryActions.importBundle(parsed.data, file.name);
    toast.success(`Designs from ${file.name}: ${importSummary(report)}.`);
  },
};
