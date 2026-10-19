// Animation tools (DESIGN.md › Animation): video export, step stills, the
// files for Claude, the Overlay Editor and overlay design files. Codes are
// ASSIGNED (ALT 1311-1319, 1410-1420, 1494, 1499-1503, 1549-1552, 1599-1604,
// 1662, 1664-1670); never
// renumber.

import type { HotkeyDef } from '@treDeSpaceUI/hotkeys';
import { isAnimationPanelOpen } from '../components/panels/animation/animationPanels';
import { replayOverlayPreview } from '../components/panels/overlay-editor/overlayEditorPanel';
import { PRESET_STEP_CARD } from '../lib/overlay/overlayPresets';
import { animationDocState } from '../state/animation/animationDoc.state';
import { claudeActions } from '../state/animation/claude.actions';
import { overlayEditorActions } from '../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../state/animation/overlayEditor.state';
import { stillsActions } from '../state/animation/stills.actions';
import { videoExportActions } from '../state/animation/videoExport.actions';
import { type VideoExportSettings, videoExportState } from '../state/animation/videoExport.state';
import { overlayLibraryActions } from '../state/overlayComponents/overlayComponents.actions';
import { overlayFileActions } from '../state/overlayComponents/overlayFile.actions';

// -----------------------------------------------------------------------------
// constants + guards
// -----------------------------------------------------------------------------

const CATEGORY = 'Animation';
const videoOpen = () => videoExportState.get().open;
const videoIdle = () => videoOpen() && videoExportState.get().phase.kind === 'idle';
const editingOverlay = () => overlayEditorState.get().working !== null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function cycle<T>(list: readonly T[], cur: T): T {
  return list[(list.indexOf(cur) + 1) % list.length];
}

function setVideo(patch: (s: VideoExportSettings) => Partial<VideoExportSettings>): void {
  videoExportActions.set(patch(videoExportState.get().settings));
}

/** One overlay-file shortcut (works while the Overlay Editor is open). */
function overlayFile(id: string, code: number, label: string, description: string, run: () => void): HotkeyDef {
  return {
    id: `overlay.${id}`,
    category: CATEGORY,
    label: `Overlay: ${label}`,
    defaultKeys: `ALT ${code}`,
    description,
    run,
    context: () => isAnimationPanelOpen('overlayEditor'),
  };
}

/** One shortcut for the files for Claude (the brief, the item lists). */
function claude(id: string, code: number, label: string, description: string, run: () => void): HotkeyDef {
  return {
    id: `animation.claude.${id}`,
    category: CATEGORY,
    label: label,
    defaultKeys: `ALT ${code}`,
    description,
    run,
  };
}

// -----------------------------------------------------------------------------
// table
// -----------------------------------------------------------------------------

/** Video, stills, Claude and the Overlay Editor. */
export const ANIMATION_TOOL_HOTKEYS: HotkeyDef[] = [
  {
    id: 'animation.video.open',
    category: CATEGORY,
    label: 'Export video…',
    defaultKeys: 'ALT 1410',
    description: 'Open Export video: the scene as an .mp4, rendered frame by frame.',
    run: () => void videoExportActions.open(),
  },
  {
    id: 'animation.stills.export',
    category: CATEGORY,
    label: 'Export step stills (PDF)…',
    defaultKeys: 'ALT 1494',
    description: 'A PDF with a page per step: its last frame (everything in place), its name and text under it.',
    run: () => void stillsActions.exportStepStills(),
  },
  {
    id: 'animation.video.start',
    category: CATEGORY,
    label: 'Export video: start',
    defaultKeys: 'ALT 1411',
    description: 'Render the frames and download the .mp4.',
    run: () => void videoExportActions.start(),
    context: videoIdle,
  },
  {
    id: 'animation.video.close',
    category: CATEGORY,
    label: 'Export video: close',
    defaultKeys: 'ALT 1662',
    description: 'Close Export video without exporting.',
    run: () => videoExportActions.close(),
    context: videoIdle,
  },
  {
    id: 'animation.video.cancel',
    category: CATEGORY,
    label: 'Export video: cancel',
    defaultKeys: 'ALT 1412',
    description: 'Stop the running video export (nothing is saved).',
    run: () => videoExportActions.cancel(),
    context: videoOpen,
  },
  {
    id: 'animation.video.draft',
    category: CATEGORY,
    label: 'Export video: draft quality',
    defaultKeys: 'ALT 1413',
    description: 'One render per frame — fast.',
    run: () => videoExportActions.set({ quality: 'draft' }),
    context: videoIdle,
  },
  {
    id: 'animation.video.best',
    category: CATEGORY,
    label: 'Export video: best quality',
    defaultKeys: 'ALT 1414',
    description: 'Every frame smoothed like a screenshot — slower.',
    run: () => videoExportActions.set({ quality: 'best' }),
    context: videoIdle,
  },
  {
    id: 'animation.video.size',
    category: CATEGORY,
    label: 'Export video: next size',
    defaultKeys: 'ALT 1415',
    description: 'Cycle the video height: 720p, 1080p, 1440p.',
    run: () => setVideo((s) => ({ height: cycle([720, 1080, 1440] as const, s.height) })),
    context: videoIdle,
  },
  {
    id: 'animation.video.fps',
    category: CATEGORY,
    label: 'Export video: next frame rate',
    defaultKeys: 'ALT 1416',
    description: 'Cycle the frame rate: 24, 30, 60 fps.',
    run: () => setVideo((s) => ({ fps: cycle([24, 30, 60] as const, s.fps) })),
    context: videoIdle,
  },
  {
    id: 'animation.video.range',
    category: CATEGORY,
    label: 'Export video: whole scene / part',
    defaultKeys: 'ALT 1417',
    description: 'Switch what of the one scene is exported: all of it, or the part from Start to End.',
    run: () => setVideo((s) => ({ span: s.span === 'whole' ? 'part' : 'whole' })),
    context: videoIdle,
  },
  {
    id: 'animation.video.allScenes',
    category: CATEGORY,
    label: 'Export video: all scenes',
    defaultKeys: 'ALT 1664',
    description: 'Every scene in the video, one after another, each from its start to its end.',
    run: () => setVideo(() => ({ scenes: 'all' })),
    context: videoIdle,
  },
  {
    id: 'animation.video.oneScene',
    category: CATEGORY,
    label: 'Export video: one scene',
    defaultKeys: 'ALT 1665',
    description: 'One scene in the video — all of it, or a part.',
    run: () => setVideo(() => ({ scenes: 'one' })),
    context: videoIdle,
  },
  {
    id: 'animation.video.scene.next',
    category: CATEGORY,
    label: 'Export video: next scene',
    defaultKeys: 'ALT 1666',
    description: 'The next scene of the animation becomes the one the video shows.',
    run: () => {
      const scenes = animationDocState.get().doc.scenes.map((s) => s.id);
      const cur = videoExportState.get().pick.scene;
      if (scenes.length > 0) {
        videoExportActions.setPick({ scene: scenes[(scenes.indexOf(cur) + 1) % scenes.length] });
      }
    },
    context: videoIdle,
  },
  {
    id: 'animation.video.whole',
    category: CATEGORY,
    label: 'Export video: the whole scene',
    defaultKeys: 'ALT 1667',
    description: 'The one scene from its start to its end.',
    run: () => setVideo(() => ({ span: 'whole' })),
    context: videoIdle,
  },
  {
    id: 'animation.video.part',
    category: CATEGORY,
    label: 'Export video: a part',
    defaultKeys: 'ALT 1668',
    description: 'The one scene from Start to End (seconds).',
    run: () => setVideo(() => ({ span: 'part' })),
    context: videoIdle,
  },
  {
    id: 'animation.video.part.fromRange',
    category: CATEGORY,
    label: 'Export video: part from the in / out range',
    defaultKeys: 'ALT 1669',
    description: "Start and End from the Timeline's in / out range (Shift + drag on the ruler).",
    run: () => videoExportActions.partFromRange(),
    context: videoIdle,
  },
  {
    id: 'animation.video.part.fromStep',
    category: CATEGORY,
    label: 'Export video: part from the step',
    defaultKeys: 'ALT 1670',
    description: 'Start and End of the step at the time slider.',
    run: () => videoExportActions.partFromStep(),
    context: videoIdle,
  },
  {
    id: 'animation.video.overlays',
    category: CATEGORY,
    label: 'Export video: overlays',
    defaultKeys: 'ALT 1418',
    description: 'Draw the 2D overlays and scene labels into the video — or not.',
    run: () => setVideo((s) => ({ overlays: !s.overlays })),
    context: videoIdle,
  },
  {
    id: 'animation.video.hold.dec',
    category: CATEGORY,
    label: 'Export video: wait at pausing steps −',
    defaultKeys: 'ALT 1419',
    description: 'Shorter wait at the end of steps that pause (−0.5 s).',
    run: () => setVideo((s) => ({ holdS: Math.max(0, s.holdS - 0.5) })),
    context: videoIdle,
  },
  {
    id: 'animation.video.hold.inc',
    category: CATEGORY,
    label: 'Export video: wait at pausing steps +',
    defaultKeys: 'ALT 1420',
    description: 'Longer wait at the end of steps that pause (+0.5 s).',
    run: () => setVideo((s) => ({ holdS: Math.min(10, s.holdS + 0.5) })),
    context: videoIdle,
  },
  claude('brief', 1549, 'Brief for AI', 'Download the brief Claude Code writes an animation file from.', () =>
    claudeActions.brief(),
  ),
  claude(
    'items',
    1550,
    'Item list for AI — selected nodes',
    'Download the item list (CSV) of the selected nodes.',
    () => void claudeActions.itemList('nodes'),
  ),
  claude(
    'itemsChildren',
    1551,
    'Item list for AI — children',
    'Download the item list of the children of the selected nodes.',
    () => void claudeActions.itemList('children'),
  ),
  claude(
    'itemsLeaves',
    1552,
    'Item list for AI — leaves',
    'Download the item list of every leaf under the selection.',
    () => void claudeActions.itemList('leaves'),
  ),
  {
    id: 'overlay.new',
    category: CATEGORY,
    label: 'New overlay design',
    defaultKeys: 'ALT 1311',
    description: 'A new overlay design from the Step card preset, open in the Overlay Editor.',
    run: () => overlayEditorActions.newFrom(PRESET_STEP_CARD, 'Step card'),
  },
  {
    id: 'overlay.addBlock',
    category: CATEGORY,
    label: 'Overlay: add text block',
    defaultKeys: 'ALT 1312',
    description: 'Add a text block inside the selected box of the open design.',
    run: () => overlayEditorActions.addBlock('text'),
    context: editingOverlay,
  },
  ...(['box', 'image', 'icon', 'divider', 'progress'] as const).map(
    (kind, i): HotkeyDef => ({
      id: `overlay.addBlock.${kind}`,
      category: CATEGORY,
      label: `Overlay: add ${kind} block`,
      defaultKeys: `ALT ${1600 + i}`,
      description: `Add a ${kind} block inside the selected box of the open design.`,
      run: () => overlayEditorActions.addBlock(kind),
      context: editingOverlay,
    }),
  ),
  {
    id: 'overlay.block.up',
    category: CATEGORY,
    label: 'Overlay: block up',
    defaultKeys: 'ALT 1313',
    description: 'Move the selected block up.',
    run: () => {
      const b = overlayEditorState.get().selectedBlock;
      if (b) {
        overlayEditorActions.moveBlock(b, -1);
      }
    },
    context: editingOverlay,
  },
  {
    id: 'overlay.block.down',
    category: CATEGORY,
    label: 'Overlay: block down',
    defaultKeys: 'ALT 1314',
    description: 'Move the selected block down.',
    run: () => {
      const b = overlayEditorState.get().selectedBlock;
      if (b) {
        overlayEditorActions.moveBlock(b, 1);
      }
    },
    context: editingOverlay,
  },
  {
    id: 'overlay.block.remove',
    category: CATEGORY,
    label: 'Overlay: remove block',
    defaultKeys: 'ALT 1315',
    description: 'Remove the selected block.',
    run: () => {
      const b = overlayEditorState.get().selectedBlock;
      if (b) {
        overlayEditorActions.removeBlock(b);
      }
    },
    context: editingOverlay,
  },
  {
    id: 'overlay.preview.replay',
    category: CATEGORY,
    label: 'Overlay: replay effect',
    defaultKeys: 'ALT 1316',
    description: "Replay the enter effect in the Overlay Editor's preview.",
    run: () => replayOverlayPreview(),
    context: editingOverlay,
  },
  {
    id: 'overlay.undo',
    category: CATEGORY,
    label: 'Overlay: undo',
    defaultKeys: 'ALT 1317',
    description: 'Undo the last change in the Overlay Editor.',
    run: () => overlayEditorActions.undo(),
    context: editingOverlay,
  },
  {
    id: 'overlay.redo',
    category: CATEGORY,
    label: 'Overlay: redo',
    defaultKeys: 'ALT 1318',
    description: 'Redo in the Overlay Editor.',
    run: () => overlayEditorActions.redo(),
    context: editingOverlay,
  },
  {
    id: 'overlay.save',
    category: CATEGORY,
    label: 'Overlay: save',
    defaultKeys: 'ALT 1319',
    description: 'Save the open design to your library — every overlay using it is restyled.',
    run: () => overlayEditorActions.save(),
    context: editingOverlay,
  },
  {
    id: 'overlay.component.remove',
    category: CATEGORY,
    label: 'Overlay: remove this design from the library',
    defaultKeys: 'ALT 1599',
    description: 'Remove the design open in the Overlay Editor from your library (not a preset).',
    run: () => {
      const w = overlayEditorState.get().working;
      if (w && !w.id.startsWith('preset.')) {
        overlayLibraryActions.removeComponent(w.id);
      }
    },
    context: editingOverlay,
  },
  overlayFile('export', 1499, 'export this design', 'Save the design open in the Overlay Editor to a file.', () =>
    overlayFileActions.exportOpen(),
  ),
  overlayFile('exportAll', 1500, 'export all my designs', 'Save all your own designs and themes to one file.', () =>
    overlayFileActions.exportAll(),
  ),
  overlayFile(
    'import',
    1501,
    'import designs',
    'Add the designs and themes in a file to your library.',
    () => void overlayFileActions.importFile(),
  ),
  {
    id: 'overlay.textScale.dec',
    category: CATEGORY,
    label: 'Overlay: design text smaller',
    defaultKeys: 'ALT 1502',
    description: 'Every text of the open design a step smaller (its Text size ×).',
    run: () => overlayEditorActions.nudgeTextScale(-1),
    context: editingOverlay,
  },
  {
    id: 'overlay.textScale.inc',
    category: CATEGORY,
    label: 'Overlay: design text bigger',
    defaultKeys: 'ALT 1503',
    description: 'Every text of the open design a step bigger (its Text size ×).',
    run: () => overlayEditorActions.nudgeTextScale(1),
    context: editingOverlay,
  },
];
