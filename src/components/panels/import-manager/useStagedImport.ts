import type { TreeFile } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act, type ImportSource } from '../../../state/assets/assets.actions';
import { allStagedPaths, type Staged, selectedStagedFiles } from './staging';

export type StagedImport = Readonly<{
  staged: Staged | null;
  treeSel: Set<string>;
  setTreeSel: (s: Set<string>) => void;
  folder: string;
  setFolder: (f: string) => void;
  stage: (s: Staged | null) => void;
  clear: () => void;
  allPaths: () => string[];
  selectedFiles: () => TreeFile[];
  doImport: () => Promise<void>;
}>;

/** Shared staging state + import flow for the merged-GLB and TDP sections:
 *  one staged tree/pick-list at a time, a selection set over it, and the
 *  folder name imports land under. */
export function useStagedImport(): StagedImport {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [treeSel, setTreeSel] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState('');

  const stage = (s: Staged | null) => {
    if (!s) {
      return;
    }
    setStaged(s);
    // flat file picks start fully selected; a tree starts empty (pick in it)
    setTreeSel(new Set(s.files.map((f) => f.path)));
    // folder defaults: picked directory's name for trees, "misc" for file picks
    setFolder(s.defaultName);
  };

  const selectedFiles = () => selectedStagedFiles(staged, treeSel);

  const doImport = async () => {
    const files = selectedFiles();
    if (files.length === 0) {
      return;
    }
    const sources: ImportSource[] = files
      .filter((f) => f.handle != null)
      .map((f) => ({
        name: f.name,
        // TDP tree picks keep the scanned subfolder structure under the base
        // folder (the Folder input, defaulting to the picked directory's name)
        folder:
          staged?.kind === 'tdp' && staged.tree
            ? [folder, ...f.path.split('/').slice(0, -1)].filter(Boolean).join('/')
            : undefined,
        bytes: async () => {
          const h = f.handle;
          if (!h) {
            throw new Error('missing file handle');
          }
          return (await h.getFile()).arrayBuffer();
        },
      }));
    await act.importSources(sources, { folder });
    setStaged(null);
  };

  return {
    staged,
    treeSel,
    setTreeSel,
    folder,
    setFolder,
    stage,
    clear: () => setStaged(null),
    allPaths: () => allStagedPaths(staged),
    selectedFiles,
    doImport,
  };
}
