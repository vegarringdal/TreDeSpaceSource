import { IconClock, IconDatabase } from '@tabler/icons-react';
import { FileTree, TextInput, type TreeDir } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { MAIN_STORE, TEMP_STORE } from '../../../state/stores/stores.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { NO_IMPORTABLE_FILES } from './scanDirectory';
import { type AssetsLibraryModel, parseDirRef } from './useAssetsLibrary';

/** The unified library tree: store section bands + per-store folders in one
 *  FileTree, with drag/context-menu folder management. Cross-store moves are
 *  rejected (assets stay in their store); the root gap ungroups within each
 *  asset's own store. */
export function AssetsLibraryTree({ m }: { m: AssetsLibraryModel }) {
  const storeOf = (id: string): string | undefined => assetsState.get().assets.find((a) => a.id === id)?.store;

  const handleMove = (ids: string[], dirPath: string) => {
    if (dirPath === '') {
      void act.moveToFolder(ids, '');
      return;
    }
    const ref = parseDirRef(dirPath);
    if (!ref) {
      return;
    }
    const ok = ids.filter((id) => storeOf(id) === ref.store);
    if (ok.length < ids.length) {
      dialogs.error(
        `${ids.length - ok.length} asset(s) belong to another store — cross-store moves aren't supported yet.`,
        'Model Assets',
      );
    }
    if (ok.length) {
      void act.moveToFolder(ok, ref.path);
    }
  };

  const handleMoveFolder = (dirPath: string, target: string) => {
    const from = parseDirRef(dirPath);
    if (!from) {
      return;
    }
    const to = target === '' ? { store: from.store, path: '' } : parseDirRef(target);
    if (!to) {
      return;
    }
    if (to.store !== from.store) {
      dialogs.error("Folders can't move between stores — cross-store moves aren't supported yet.", 'Model Assets');
      return;
    }
    void act.moveFolder(from.store, from.path, to.path);
  };

  const sectionIcon = (name: string) =>
    name === TEMP_STORE ? (
      <IconClock size={13} className="shrink-0 text-slate-500" />
    ) : (
      <IconDatabase size={13} className="shrink-0 text-slate-500" />
    );
  const root: TreeDir = {
    ...m.tree,
    children: m.tree.children.map((c) => (c.kind === 'dir' ? { ...c, icon: sectionIcon(c.name) } : c)),
  };

  return (
    <>
      <FileTree
        key={m.treeKey}
        className="min-h-24 flex-1"
        emptyText={NO_IMPORTABLE_FILES}
        root={root}
        selected={m.selectedSet}
        onSelect={m.setSelection}
        defaultCollapsed={m.defaultCollapsed}
        collapseAllSignal={m.treeCollapseSignal}
        expandAllSignal={m.treeExpandSignal}
        onAddFolder={(parent) => {
          const ref = parent ? parseDirRef(parent) : { store: MAIN_STORE, path: '' };
          if (ref) {
            void act.addFolder(ref.store, ref.path);
          }
        }}
        onRenameFolder={(dirPath) => {
          const ref = parseDirRef(dirPath);
          if (ref) {
            void act.renameFolder(ref.store, ref.path);
          }
        }}
        onDeleteFolder={(dirPath) => {
          const ref = parseDirRef(dirPath);
          if (ref) {
            void act.deleteFolder(ref.store, ref.path);
          }
        }}
        onMove={handleMove}
        onMoveFolder={handleMoveFolder}
      />
      <div className="text-[11px] text-slate-500">
        Click selects · Ctrl toggles · Shift ranges · drag onto a folder to move · right-click for New folder
      </div>
      {m.selectedOne && (
        <label className="flex items-center gap-2 text-slate-400 text-xs">
          <span className="w-14 shrink-0">Rename</span>
          <TextInput
            value={m.selectedOne.name}
            onChange={(v) => m.selectedOne && void act.rename(m.selectedOne.id, v)}
          />
        </label>
      )}
    </>
  );
}
