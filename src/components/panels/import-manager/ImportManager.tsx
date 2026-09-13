import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoButton, PanelHeader } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { storesActions } from '../../../state/stores/stores.actions';
import { registerStagingSelect } from '../model-assets/stagingSelect';
import { IfcSection } from './IfcSection';
import { MergedGlbSection } from './MergedGlbSection';
import { RvmSection } from './RvmSection';
import { StdGlbSection } from './StdGlbSection';
import { StepSection } from './StepSection';
import { TdpSection } from './TdpSection';
import { useStagedImport } from './useStagedImport';

/** Import Manager: bring models into the Model Assets library. Each format has
 *  its own section component; the merged-GLB and TDP sections share one
 *  staging state (only one staged pick at a time). */
export function ImportManager() {
  useMinSize(260, 320);
  const si = useStagedImport();

  useEffect(() => {
    void storesActions.init().then(() => act.init());
  }, []);

  useEffect(() => {
    registerStagingSelect({
      all: () => si.setTreeSel(new Set(si.allPaths())),
      none: () => si.setTreeSel(new Set()),
    });
    return () => {
      registerStagingSelect(null);
    };
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <PanelHeader
        title="Import"
        actions={
          <InfoButton label="About importing">
            All conversion is done in your browser — nothing is uploaded to a server. An import <b>overwrites</b> an
            existing asset with the same store + folder + name; the old file is deleted only after the new one lands, so
            a failed import keeps the previous version.
          </InfoButton>
        }
      />

      <MergedGlbSection si={si} />
      <TdpSection si={si} />
      <StdGlbSection />
      <RvmSection />
      <StepSection />
      <IfcSection />
    </PanelBody>
  );
}
