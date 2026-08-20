// Export panel: write the loaded scene to standard files — TDP (this app's
// cooked format), GLB, or IFC.
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { ExportGlbSection } from './ExportGlbSection';
import { ExportIfcSection } from './ExportIfcSection';
import { ExportSnapshotSection } from './ExportSnapshotSection';
import { ExportTdpSection } from './ExportTdpSection';

/** The Export panel: writes the visible scene out as TDP, GLB or IFC, and
 *  saves/loads .tdsnap state snapshots. */
export function Export() {
  useMinSize(260, 200);
  return (
    <PanelBody className="panel-body flex flex-col gap-1.5 overflow-y-auto p-2">
      <ExportTdpSection />
      <ExportGlbSection />
      <ExportIfcSection />
      <ExportSnapshotSection />
    </PanelBody>
  );
}
