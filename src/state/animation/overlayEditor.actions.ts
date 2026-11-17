// Overlay Editor actions (DESIGN.md › Animation › Overlays): open a
// component for editing, keep an undoable working copy of it, save it to the
// library (version bump — every instance restyles), make one-off copies.

import { toast } from '@treDeSpaceUI/widgets';
import { openAnimationPanel } from '../../components/panels/animation/animationPanels';
import { newId } from '../../lib/animation/io';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../lib/overlay/overlayStyle';
import type { OverlayBlock, OverlayComponent, OverlayParam, OverlayValue } from '../../lib/overlay/overlayTypes';
import { libraryComponent, overlayLibraryActions } from '../overlayComponents/overlayComponents.actions';
import { animationDocState } from './animationDoc.state';
import { calloutsActions } from './callouts.actions';
import { type OverlaySampleContext, overlayEditorState } from './overlayEditor.state';
import { findComponent } from './runtimeOverlay';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const UNDO_MAX = 100;
/** Text size step of the editor's field and hotkeys. */
export const TEXT_SCALE_STEP = 0.1;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

const undo: OverlayComponent[] = [];
const redo: OverlayComponent[] = [];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function mapBlock(b: OverlayBlock, id: string, fn: (b: OverlayBlock) => OverlayBlock | null): OverlayBlock | null {
  if (b.id === id) {
    return fn(b);
  }
  if (b.kind !== 'box') {
    return b;
  }
  const children = b.children.map((c) => mapBlock(c, id, fn)).filter((c): c is OverlayBlock => c !== null);
  return { ...b, children };
}

/** A fresh block of a kind, with sensible defaults. */
export function newBlock(kind: OverlayBlock['kind']): OverlayBlock {
  const id = newId('b');
  switch (kind) {
    case 'box':
      return {
        kind,
        id,
        style: { padding: [6, 6, 6, 6] },
        layout: { dir: 'col', gap: 4, align: 'stretch', justify: 'start' },
        children: [],
      };
    case 'text':
      return { kind, id, style: { size: 16, color: '$text' }, text: 'Text', rich: false };
    case 'image':
      return { kind, id, style: { width: 120, height: 80 }, src: '', fit: 'contain' };
    case 'icon':
      return { kind, id, style: { size: 20, color: '$accent' }, icon: 'info' };
    case 'divider':
      return { kind, id, style: { bg: '$muted' } };
    case 'progress':
      return { kind, id, style: { height: 5 }, value: '{{step.index}}/{{step.count}}' };
  }
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const overlayEditorActions = {
  /** Open a component (library copy first, else the doc's) in the editor;
   *  `sample` seeds the preview's param values (an instance's own). */
  editComponent(id: string, sample: Readonly<Record<string, OverlayValue>> = {}): void {
    const c = libraryComponent(id) ?? findComponent(animationDocState.get().doc, id);
    if (!c) {
      toast.warning('That overlay component is not in the library or the file.');
      return;
    }
    undo.length = 0;
    redo.length = 0;
    overlayEditorState.set({
      working: c,
      selectedBlock: c.root.id,
      dirty: false,
      undoDepth: 0,
      redoDepth: 0,
      sample: { ...sample },
    });
    openAnimationPanel('overlayEditor');
    openAnimationPanel('overlayPreview');
  },

  /** Restyle an overlay instance's component, previewing with its values. */
  editInstanceStyle(instanceId: string): void {
    const inst = animationDocState.get().doc.overlayInstances.find((i) => i.id === instanceId);
    if (inst) {
      overlayEditorActions.editComponent(inst.component, inst.values);
    }
  },

  /** One preview param value (not saved with the component). */
  setSampleValue(key: string, value: OverlayValue): void {
    overlayEditorState.set((s) => ({ sample: { ...s.sample, [key]: value } }));
  },

  /** The preview's part / actor names for the context placeholders. */
  setSampleContext(patch: Partial<OverlaySampleContext>): void {
    overlayEditorState.set((s) => ({ sampleContext: { ...s.sampleContext, ...patch } }));
  },

  /** The library theme the preview renders with. */
  setTheme(id: string | null): void {
    overlayEditorState.set({ theme: id });
  },

  /** Edit the working copy (undoable inside the editor). */
  change(fn: (c: OverlayComponent) => OverlayComponent): void {
    const w = overlayEditorState.get().working;
    if (!w) {
      return;
    }
    const next = fn(w);
    if (next === w) {
      return;
    }
    undo.push(w);
    if (undo.length > UNDO_MAX) {
      undo.shift();
    }
    redo.length = 0;
    overlayEditorState.set({ working: next, dirty: true, undoDepth: undo.length, redoDepth: 0 });
  },

  /** The design's text size: every text block × this (1 = as designed). */
  setTextScale(v: number): void {
    const scale = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Math.round(v * 100) / 100));
    overlayEditorActions.change((c) => {
      if ((c.textScale ?? 1) === scale) {
        return c;
      }
      const { textScale: _old, ...rest } = c;
      return scale === 1 ? rest : { ...rest, textScale: scale };
    });
  },

  /** The design's text size a step up / down (hotkeys). */
  nudgeTextScale(dir: -1 | 1): void {
    const w = overlayEditorState.get().working;
    if (w) {
      overlayEditorActions.setTextScale((w.textScale ?? 1) + dir * TEXT_SCALE_STEP);
    }
  },

  updateBlock(blockId: string, fn: (b: OverlayBlock) => OverlayBlock): void {
    overlayEditorActions.change((c) => ({ ...c, root: mapBlock(c.root, blockId, fn) ?? c.root }));
  },

  /** Add a block inside the selected box (or next to the selected block). */
  addBlock(kind: OverlayBlock['kind']): void {
    const s = overlayEditorState.get();
    const target = s.selectedBlock ?? s.working?.root.id;
    const block = newBlock(kind);
    overlayEditorActions.change((c) => {
      const find = (b: OverlayBlock): OverlayBlock | null =>
        b.id === target ? b : b.kind === 'box' ? (b.children.map(find).find((x) => x) ?? null) : null;
      const sel = find(c.root);
      const boxId = sel?.kind === 'box' ? sel.id : c.root.id;
      return {
        ...c,
        root:
          mapBlock(c.root, boxId, (b) => (b.kind === 'box' ? { ...b, children: [...b.children, block] } : b)) ?? c.root,
      };
    });
    overlayEditorState.set({ selectedBlock: block.id });
  },

  removeBlock(blockId: string): void {
    overlayEditorActions.change((c) =>
      blockId === c.root.id ? c : { ...c, root: mapBlock(c.root, blockId, () => null) ?? c.root },
    );
    overlayEditorState.set({ selectedBlock: overlayEditorState.get().working?.root.id ?? null });
  },

  /** Move a block up / down among its siblings. */
  moveBlock(blockId: string, dir: -1 | 1): void {
    const shift = (b: OverlayBlock): OverlayBlock => {
      if (b.kind !== 'box') {
        return b;
      }
      const i = b.children.findIndex((c) => c.id === blockId);
      if (i < 0) {
        return { ...b, children: b.children.map(shift) };
      }
      const j = i + dir;
      if (j < 0 || j >= b.children.length) {
        return b;
      }
      const kids = [...b.children];
      [kids[i], kids[j]] = [kids[j], kids[i]];
      return { ...b, children: kids };
    };
    overlayEditorActions.change((c) => ({ ...c, root: shift(c.root) }));
  },

  setParams(params: OverlayParam[]): void {
    overlayEditorActions.change((c) => ({ ...c, params }));
  },

  select(blockId: string | null): void {
    overlayEditorState.set({ selectedBlock: blockId });
  },

  setPreview(
    patch: Partial<
      Pick<ReturnType<typeof overlayEditorState.get>, 'previewHeight' | 'previewBg' | 'previewFx' | 'sample'>
    >,
  ): void {
    overlayEditorState.set(patch);
  },

  undo(): void {
    const prev = undo.pop();
    const w = overlayEditorState.get().working;
    if (!prev || !w) {
      return;
    }
    redo.push(w);
    overlayEditorState.set({ working: prev, dirty: true, undoDepth: undo.length, redoDepth: redo.length });
  },

  redo(): void {
    const next = redo.pop();
    const w = overlayEditorState.get().working;
    if (!next || !w) {
      return;
    }
    undo.push(w);
    overlayEditorState.set({ working: next, dirty: true, undoDepth: undo.length, redoDepth: redo.length });
  },

  /** Save to the library: the version is bumped, every instance restyles. */
  save(): void {
    const w = overlayEditorState.get().working;
    if (!w) {
      return;
    }
    const saved = overlayLibraryActions.saveComponent(w);
    overlayEditorState.set({ working: saved, dirty: false });
    toast.success(`Saved "${saved.name}" (v${saved.version}) — every overlay using it is restyled.`);
  },

  /** A new component from a preset / the current one (the editor always
   *  starts from a preset, DESIGN.md › Animation › Authoring). */
  newFrom(base: OverlayComponent, name?: string): void {
    const copy: OverlayComponent = {
      ...structuredClone(base),
      id: newId('oc'),
      name: name ?? `${base.name} copy`,
      version: 1,
    };
    overlayLibraryActions.saveComponent(copy);
    overlayEditorActions.editComponent(copy.id);
  },

  /** Detach an instance: it gets its own copy of the component. */
  detach(instanceId: string): void {
    const inst = animationDocState.get().doc.overlayInstances.find((i) => i.id === instanceId);
    const base = inst
      ? (libraryComponent(inst.component) ?? findComponent(animationDocState.get().doc, inst.component))
      : null;
    if (!inst || !base) {
      return;
    }
    const copy: OverlayComponent = {
      ...structuredClone(base),
      id: newId('oc'),
      name: `${base.name} (one-off)`,
      version: 1,
    };
    overlayLibraryActions.saveComponent(copy);
    calloutsActions.detach(instanceId, copy.id);
    toast.info(`"${copy.name}" is now this overlay's own style.`);
  },
};
