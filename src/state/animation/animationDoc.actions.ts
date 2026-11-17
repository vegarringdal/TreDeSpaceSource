// Animation doc lifecycle (DESIGN.md › Animation › Authoring, Files and host API): new /
// load / save, snapshot undo/redo, the autosaved OPFS draft, and `commit` —
// the one write path every edit module goes through. Docs are replaced
// immutably, so an undo snapshot is just the previous doc reference
// (structural sharing keeps the stack cheap).

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { emptyDoc, parseAnimationDoc, serializeAnimationDoc, validateAnimationDoc } from '../../lib/animation/io';
import type { AnimationDoc } from '../../lib/animation/types';
import { downloadText } from '../../lib/download';
import { ANIMATION_DRAFT_FILE, deleteFile, readJson, rootDir, writeJson } from '../../lib/opfs/opfs';
import type { OverlayComponent } from '../../lib/overlay/overlayTypes';
import { overlayLibraryActions } from '../overlayComponents/overlayComponents.actions';
import { overlayLibraryState } from '../overlayComponents/overlayComponents.state';
import { animationDocState } from './animationDoc.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface LoadReport {
  ok: boolean;
  errors: string[];
  componentConflicts: { id: string; fileVersion: number; libraryVersion: number }[];
}

interface Draft {
  savedAt: number;
  fileName: string | null;
  doc: unknown;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Undo depth (snapshots share structure, so this is cheap). */
const UNDO_MAX = 200;
/** Consecutive edits with the same coalesce key inside this window are one
 *  undo step (a scrubbed number, typing). */
const COALESCE_MS = 700;

/** A coalesce key starting with this names one gesture (a drag): all its
 *  edits are one undo step however slowly it goes — a pause mid-drag never
 *  splits it, and the drag's last edit never adds a step of its own. */
export const GESTURE_COALESCE = 'gesture:';
/** Draft autosave cadence while dirty (DESIGN.md › Animation › Files and host API). */
const DRAFT_MS = 5000;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

const undo: AnimationDoc[] = [];
const redo: AnimationDoc[] = [];
let lastCoalesce: { key: string; at: number } | null = null;
let draftTimer = 0;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function publish(doc: AnimationDoc, patch: { dirty?: boolean; fileName?: string | null } = {}): void {
  const s = animationDocState.get();
  const active = doc.scenes.some((x) => x.id === s.activeScene) ? s.activeScene : (doc.scenes[0]?.id ?? '');
  animationDocState.set({
    doc,
    revision: s.revision + 1,
    activeScene: active,
    undoDepth: undo.length,
    redoDepth: redo.length,
    ...patch,
  });
}

function scheduleDraft(): void {
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => void writeDraft(), DRAFT_MS);
}

async function writeDraft(): Promise<void> {
  const s = animationDocState.get();
  // an earlier session's draft waits for Recover / Discard: never write over it
  if (!s.dirty || s.draftAvailable) {
    return;
  }
  const draft: Draft = { savedAt: Date.now(), fileName: s.fileName, doc: s.doc };
  try {
    await writeJson(await rootDir(), ANIMATION_DRAFT_FILE, draft);
  } catch {
    // OPFS unavailable — no draft this session
  }
}

/** Delete the draft — this session's (it was saved, or replaced). An
 *  earlier session's draft still on offer stays unless `force` (Discard). */
async function clearDraft(force = false): Promise<void> {
  clearTimeout(draftTimer);
  if (!force && animationDocState.get().draftAvailable) {
    return;
  }
  try {
    await deleteFile(await rootDir(), ANIMATION_DRAFT_FILE);
  } catch {
    // nothing to clear
  }
  animationDocState.set({ draftAvailable: false });
}

/** Library components whose version differs from the file's embedded copy. */
function componentConflicts(doc: AnimationDoc): LoadReport['componentConflicts'] {
  const lib = new Map(overlayLibraryState.get().components.map((c) => [c.id, c]));
  return doc.overlayComponents
    .filter((c) => {
      const l = lib.get(c.id);
      return l !== undefined && l.version !== c.version;
    })
    .map((c) => ({ id: c.id, fileVersion: c.version, libraryVersion: lib.get(c.id)?.version ?? 0 }));
}

/** Components and themes the doc uses — callouts, the scenes' step cards
 *  and steps' own cards — copied from the library, so the file shows the
 *  same anywhere. */
function embedOverlays(doc: AnimationDoc): AnimationDoc {
  const used = new Set<string>(doc.overlayInstances.map((i) => i.component));
  const themes = new Set<string>(doc.overlayInstances.map((i) => i.theme).filter((t): t is string => t !== null));
  for (const scene of doc.scenes) {
    if (scene.stepCard) {
      used.add(scene.stepCard.component);
      if (scene.stepCard.theme) {
        themes.add(scene.stepCard.theme);
      }
    }
    for (const step of scene.steps) {
      if (step.card) {
        used.add(step.card.component);
        if (step.card.theme) {
          themes.add(step.card.theme);
        }
      }
    }
  }
  const lib = overlayLibraryState.get();
  const pick = <T extends { id: string }>(ids: Set<string>, library: readonly T[], embedded: readonly T[]): T[] =>
    [...ids]
      .map((id) => library.find((x) => x.id === id) ?? embedded.find((x) => x.id === id))
      .filter((x): x is T => !!x);
  return {
    ...doc,
    overlayComponents: pick(used, lib.components, doc.overlayComponents),
    overlayThemes: pick(themes, lib.themes, doc.overlayThemes),
  };
}

function safeFileName(name: string): string {
  const base = name.replace(/[^\w\-. ]+/g, '_').trim() || 'animation';
  return base.endsWith('.tdanim.json') ? base : `${base}.tdanim.json`;
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const animationDocActions = {
  /** The one write path: apply `fn` to the current doc. Undoable; `coalesce`
   *  merges a burst of edits (drag) into one step. */
  commit(fn: (doc: AnimationDoc) => AnimationDoc, coalesce?: string): void {
    const cur = animationDocState.get().doc;
    const next = fn(cur);
    if (next === cur) {
      return;
    }
    const now = performance.now();
    const merge =
      coalesce !== undefined &&
      lastCoalesce?.key === coalesce &&
      (coalesce.startsWith(GESTURE_COALESCE) || now - lastCoalesce.at < COALESCE_MS);
    if (!merge) {
      undo.push(cur);
      if (undo.length > UNDO_MAX) {
        undo.shift();
      }
    }
    lastCoalesce = coalesce !== undefined ? { key: coalesce, at: now } : null;
    redo.length = 0;
    publish(next, { dirty: true });
    scheduleDraft();
  },

  /** A savepoint: rollback() returns to it, dropping every commit since
   *  (record mode's Esc). */
  mark(): { depth: number; doc: AnimationDoc } {
    lastCoalesce = null;
    return { depth: undo.length, doc: animationDocState.get().doc };
  },

  rollback(m: { depth: number; doc: AnimationDoc }): void {
    undo.length = Math.min(undo.length, m.depth);
    redo.length = 0;
    lastCoalesce = null;
    publish(m.doc, { dirty: true });
    scheduleDraft();
  },

  undo(): void {
    const prev = undo.pop();
    if (!prev) {
      return;
    }
    redo.push(animationDocState.get().doc);
    lastCoalesce = null;
    publish(prev, { dirty: true });
    scheduleDraft();
  },

  redo(): void {
    const next = redo.pop();
    if (!next) {
      return;
    }
    undo.push(animationDocState.get().doc);
    lastCoalesce = null;
    publish(next, { dirty: true });
    scheduleDraft();
  },

  /** A fresh doc (asks first when there are unsaved edits). */
  async newDoc(name = 'Animation'): Promise<boolean> {
    if (
      animationDocState.get().dirty &&
      !(await dialogs.confirm('Discard the unsaved animation?', { okLabel: 'Discard' }))
    ) {
      return false;
    }
    undo.length = 0;
    redo.length = 0;
    publish(emptyDoc(name), { dirty: false, fileName: null });
    await clearDraft();
    return true;
  },

  /** Replace the doc with a validated one (file open, SDK, recovery). With
   *  `interactive` off (the SDK) a component conflict keeps the library's
   *  copy and is only reported. */
  async adopt(doc: AnimationDoc, fileName: string | null, interactive = true): Promise<LoadReport> {
    const conflicts = componentConflicts(doc);
    if (conflicts.length > 0 && interactive) {
      const useFile = await dialogs.confirm(
        `${conflicts.length} overlay component(s) in this file differ from your library ` +
          `(${conflicts.map((c) => `${c.id} v${c.fileVersion} vs v${c.libraryVersion}`).join(', ')}). ` +
          "Use the file's versions? Cancel keeps your library's.",
        { title: 'Overlay components', okLabel: "Use the file's", cancelLabel: 'Keep mine' },
      );
      if (useFile) {
        for (const c of doc.overlayComponents.filter((x): x is OverlayComponent =>
          conflicts.some((k) => k.id === x.id),
        )) {
          overlayLibraryActions.adoptComponent(c);
        }
      }
    }
    undo.length = 0;
    redo.length = 0;
    publish(doc, { dirty: false, fileName });
    return { ok: true, errors: [], componentConflicts: conflicts };
  },

  /** Load a `*.tdanim.json` text. Unknown format / newer version: nothing
   *  changes and the error is reported (DESIGN.md › Animation › Files and host API). */
  async loadFromText(text: string, fileName: string | null = null): Promise<LoadReport> {
    const r = parseAnimationDoc(text);
    if (!r.doc) {
      return { ok: false, errors: [r.error ?? 'Unreadable animation file'], componentConflicts: [] };
    }
    if (
      animationDocState.get().dirty &&
      !(await dialogs.confirm('Replace the unsaved animation?', { okLabel: 'Replace' }))
    ) {
      return { ok: false, errors: ['cancelled'], componentConflicts: [] };
    }
    const report = await animationDocActions.adopt(r.doc, fileName);
    await clearDraft();
    return report;
  },

  /** Load an already-parsed doc (SDK `animation.load`) — no dialogs. */
  async loadFromValue(value: unknown): Promise<LoadReport> {
    const r = validateAnimationDoc(value);
    if (!r.doc) {
      return { ok: false, errors: [r.error ?? 'Invalid animation'], componentConflicts: [] };
    }
    const report = await animationDocActions.adopt(r.doc, null, false);
    await clearDraft();
    return report;
  },

  /** The doc as it would be saved (overlays embedded). */
  docForSave(): AnimationDoc {
    return embedOverlays(animationDocState.get().doc);
  },

  /** Download the doc (the designs and themes it uses embedded). */
  saveToFile(): void {
    const s = animationDocState.get();
    const doc = embedOverlays(s.doc);
    const name = safeFileName(s.fileName ?? doc.name);
    downloadText(name, serializeAnimationDoc(doc));
    animationDocState.set({ dirty: false, fileName: name });
    void clearDraft();
  },

  rename(name: string): void {
    animationDocActions.commit((d) => (d.name === name ? d : { ...d, name }), 'doc-name');
  },

  setActiveScene(id: string): void {
    if (animationDocState.get().doc.scenes.some((x) => x.id === id)) {
      animationDocState.set({ activeScene: id });
    }
  },

  /** Startup: is there a draft from an earlier session? */
  async checkDraft(): Promise<void> {
    try {
      const d = await readJson<Draft>(await rootDir(), ANIMATION_DRAFT_FILE);
      animationDocState.set({ draftAvailable: !!d?.doc });
    } catch {
      animationDocState.set({ draftAvailable: false });
    }
  },

  /** Restore the autosaved draft (true when one was recovered). */
  async recoverDraft(): Promise<boolean> {
    let d: Draft | null = null;
    try {
      d = await readJson<Draft>(await rootDir(), ANIMATION_DRAFT_FILE);
    } catch {
      d = null;
    }
    const r = d ? validateAnimationDoc(d.doc) : null;
    if (!r?.doc) {
      await clearDraft(true);
      animationDocState.set({ draftAvailable: false });
      toast.info('The unsaved animation could not be read, so it was thrown away.');
      return false;
    }
    await animationDocActions.adopt(r.doc, d?.fileName ?? null);
    animationDocState.set({ dirty: true, draftAvailable: false });
    return true;
  },

  async discardDraft(): Promise<void> {
    await clearDraft(true);
    animationDocState.set({ draftAvailable: false });
  },
};
