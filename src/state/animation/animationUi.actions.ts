// Animation mode + what the Key panel shows (DESIGN.md › Animation). Mode
// transitions run through here so the player, the gizmo policy, the overlay
// layer's authoring gestures and the panels stay in step:
//
//   off ──Animate──▶ author ──Animate──▶ off
//    └──play / present──▶ playback ──Stop / close──▶ off

import { isAnimationPanelOpen, openAnimationPanel } from '../../components/panels/animation/animationPanels';
import { setColorRulesRunInterceptor } from '../../components/panels/multi-color/multiColor.actions';
import { emptyScene } from '../../lib/animation/io';
import type { RuleSet } from '../../lib/animation/types';
import { storageKey } from '../../lib/storageKeys';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { type AnimationUiState, animationUiState, type Picked } from './animationUi.state';
import { annotationsActions } from './annotations.actions';
import { calloutsActions } from './callouts.actions';
import { gizmoPivotSync } from './gizmoPivotSync';
import { playerActions } from './player.actions';
import { playerState } from './player.state';
import { posingActions } from './posing.actions';
import type { RowId } from './rows';
import { editedRulesKey, rulesEditorActions } from './rulesEditor.actions';
import { setOverlayHandlers, setSelectedOverlay } from './runtime';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const LABEL_WIDTH_KEY = storageKey('timelineLabels');
const LABEL_MIN_PX = 80;
const LABEL_MAX_PX = 600;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function installAuthoringGestures(): void {
  setOverlayHandlers({
    onMove: (id, anchor) => calloutsActions.moveOverlay(id, anchor),
    onEditText: (id, param, value) => calloutsActions.setValue(id, param, value),
    onSelect: (id) => {
      const c = calloutsActions.ofInstance(id);
      if (c) {
        animationUiActions.pick({ kind: 'callout', id: c.id, keys: [] });
      }
    },
  });
}

/** Set Color's Run while authoring: the rules become the Key panel's next
 *  rules key, shown on the scene, not run into it — Key keys them. */
function previewRules(rules: RuleSet): boolean {
  if (animationUiState.get().mode.kind !== 'author') {
    return false;
  }
  if (editedRulesKey() !== null) {
    animationUiActions.pick({ kind: 'none' });
  }
  animationUiState.set({ current: '@rules' });
  rulesEditorActions.take(rules);
  return true;
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const animationUiActions = {
  /** The ribbon's / Timeline's Animate: enter / leave authoring. */
  async toggleMode(): Promise<void> {
    if (animationUiState.get().mode.kind === 'author') {
      await animationUiActions.exitMode();
    } else {
      await animationUiActions.enterAuthoring();
    }
  },

  async enterAuthoring(): Promise<boolean> {
    if (animationDocState.get().doc.scenes.length === 0) {
      animationDocActions.commit((d) => ({ ...d, scenes: [emptyScene()] }));
    }
    const ok = playerState.get().status === 'off' ? await playerActions.enter('author') : true;
    if (!ok) {
      return false;
    }
    playerActions.setMode('author');
    animationUiState.set({ mode: { kind: 'author' } });
    installAuthoringGestures();
    posingActions.install(true);
    gizmoPivotSync.install(true);
    setColorRulesRunInterceptor(previewRules);
    rulesEditorActions.install(true);
    annotationsActions.install(true, true);
    openAnimationPanel('animationTimeline');
    return true;
  },

  /** Playback only (presenting, the host's play bar): no editing. */
  async enterPlayback(): Promise<boolean> {
    const ok = playerState.get().status === 'off' ? await playerActions.enter('playback') : true;
    if (!ok) {
      return false;
    }
    posingActions.install(false);
    gizmoPivotSync.install(false);
    posingActions.installPlaybackGizmo(true);
    setColorRulesRunInterceptor(null);
    rulesEditorActions.install(false);
    annotationsActions.install(true, false);
    playerActions.setMode('playback');
    animationUiState.set({ mode: { kind: 'playback' } });
    setOverlayHandlers(null);
    return true;
  },

  /** The mode on, for commands that play or export while it may be off:
   *  authoring when the Timeline or the Key panel is open (the authoring
   *  workspace — what it shows then stays editable), else playback; a mode
   *  already on stays. */
  async ensureMode(): Promise<boolean> {
    if (playerState.get().status !== 'off') {
      return true;
    }
    const authoringOpen = isAnimationPanelOpen('animationTimeline') || isAnimationPanelOpen('animation');
    return authoringOpen ? animationUiActions.enterAuthoring() : animationUiActions.enterPlayback();
  },

  /** Leave animation mode entirely — the scene is restored. */
  async exitMode(): Promise<void> {
    posingActions.install(false);
    gizmoPivotSync.install(false);
    posingActions.installPlaybackGizmo(false);
    setColorRulesRunInterceptor(null);
    rulesEditorActions.install(false);
    annotationsActions.install(false);
    setOverlayHandlers(null);
    setSelectedOverlay(null);
    animationUiState.set({
      mode: { kind: 'off' },
      posing: null,
      previewRules: false,
      nextPivot: null,
      nextInterp: null,
      objectSelection: [],
    });
    await playerActions.exit();
  },

  isAuthoring(): boolean {
    return animationUiState.get().mode.kind === 'author';
  },

  /** What the Key panel shows (a callout pick highlights it in the view). */
  pick(p: Picked): void {
    animationUiState.set({ picked: p });
    const c =
      p.kind === 'callout'
        ? animationDocState
            .get()
            .doc.scenes.flatMap((s) => s.callouts)
            .find((x) => x.id === p.id)
        : null;
    setSelectedOverlay(c?.instance ?? null);
  },

  /** The row Key keys. */
  setCurrent(row: RowId | null): void {
    animationUiState.set({ current: row });
  },

  set(patch: Partial<Omit<AnimationUiState, 'mode' | 'picked'>>): void {
    animationUiState.set(patch);
  },

  /** The Timeline's name column width (dragged), kept for next time. */
  setTimelineLabelWidth(px: number): void {
    animationUiState.set({ timelineLabelWidth: px });
    try {
      localStorage.setItem(LABEL_WIDTH_KEY, String(px));
    } catch {
      // storage blocked — the width lives for the session
    }
  },

  /** Startup: the saved Timeline name column width. */
  loadTimelinePrefs(): void {
    try {
      const px = Number(localStorage.getItem(LABEL_WIDTH_KEY));
      if (Number.isFinite(px) && px >= LABEL_MIN_PX && px <= LABEL_MAX_PX) {
        animationUiState.set({ timelineLabelWidth: px });
      }
    } catch {
      // storage blocked — the default width
    }
  },

  toggleAutoKey(): void {
    animationUiState.set((s) => ({ autoKey: !s.autoKey }));
  },

  togglePaths(): void {
    animationUiState.set((s) => ({ showPaths: !s.showPaths }));
  },

  toggleSnap(): void {
    animationUiState.set((s) => ({ snap: !s.snap }));
  },
};
