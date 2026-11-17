import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { OverlayComponent, OverlayFx, OverlayValue } from '../../lib/overlay/overlayTypes';

/** What the preview fills the context placeholders with. */
export interface OverlaySampleContext {
  stepName: string;
  stepText: string;
  objectName: string;
}

/** The Overlay Editor's working copy and preview settings (DESIGN.md
 *  › Animation › Overlays). Mutations in overlayEditor.actions.ts. */
export interface OverlayEditorState {
  /** the component being edited (saved to the library on Save) */
  working: OverlayComponent | null;
  selectedBlock: string | null;
  dirty: boolean;
  undoDepth: number;
  redoDepth: number;
  /** preview zoom: 'fit' fills the preview box; a height shows the card at
   *  its real size on a viewport that tall (the design scale reference) */
  previewHeight: 'fit' | 720 | 1080 | 1440;
  previewBg: 'scene' | 'dark' | 'light' | 'checker';
  /** replay the enter effect in the preview */
  previewFx: OverlayFx;
  /** sample param values for the preview (empty = each param's default) */
  sample: Record<string, OverlayValue>;
  /** sample playback context for the {{step.*}} / {{object.name}} placeholders */
  sampleContext: OverlaySampleContext;
  /** library theme the preview renders with (null = Auto: the app's light /
   *  dark theme, as overlays without a theme are drawn) */
  theme: string | null;
}

export const overlayEditorState = createStore<OverlayEditorState>({
  working: null,
  selectedBlock: null,
  dirty: false,
  undoDepth: 0,
  redoDepth: 0,
  previewHeight: 'fit',
  previewBg: 'dark',
  previewFx: { kind: 'pop', duration: 0.4 },
  sample: {},
  sampleContext: {
    stepName: 'Mount pump base',
    stepText: 'Torque the **bolts** to 80 Nm.',
    objectName: 'PUMP-101',
  },
  theme: null,
});
