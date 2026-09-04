import { IconBuildingFactory2, IconSitemap } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { ExportClipCheck } from './ExportClipCheck';
import { exportActions as act } from './export.actions';

/** Export → IFC: hand a small visible selection to BIM tools as IFC4 with
 *  triangulated geometry at true world positions. */
export function ExportIfcSection() {
  return (
    <Collapsible
      title="IFC"
      info={
        <>
          Made for handing a <b>small selection</b> to BIM tools — isolate the parts you need (hide the rest) and export
          just those. It is <b>not</b> a full-scene export path: IFC is a text format, so a whole plant makes an
          enormous file. Use TDP for full scenes.
          <br />
          <br />
          IFC4 with <b>triangulated</b> geometry and colors as surface styles. Exports what is currently <b>visible</b>{' '}
          with the current colors and transforms. Meshes keep their <b>true world positions</b> — the GLB options above
          (Recenter, Keep Z up) do not apply; IFC is natively Z-up in metres and BIM coordination needs real
          coordinates. <b>Exclude clipped parts</b> leaves out the parts the clip volume hides entirely.
        </>
      }
    >
      <ExportClipCheck />
      <Button
        icon={<IconBuildingFactory2 size={14} />}
        tooltip="Export the visible scene as a merged IFC4 file (one proxy per color under a default building)"
        shortcut="export.ifc"
        onClick={() => void act.exportIfc('merged')}
      >
        Export merged IFC
      </Button>
      <Button
        icon={<IconSitemap size={14} />}
        tooltip="Export an IFC4 file with the app's tree as nested aggregates of named proxies — keeps structure, larger file"
        shortcut="export.ifcHierarchy"
        onClick={() => void act.exportIfc('hierarchy')}
      >
        Export hierarchy IFC
      </Button>
    </Collapsible>
  );
}
