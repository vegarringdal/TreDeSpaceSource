import { IconBox, IconSitemap } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { exportActions as act } from './export.actions';

/** Export → TDP: write the visible scene to this app's cooked format, merged
 *  per color or with the item hierarchy preserved. */
export function ExportTdpSection() {
  return (
    <Collapsible
      title="TDP (TreDeSpace)"
      info={
        <>
          This app's own cooked format. Exports what is currently <b>visible</b> with the current colors, opacity and
          transforms — so you can trim a scene to just the elements you want, restyle it, and save it ready to load. You
          pick a folder; each loaded model becomes its own <code>.tdp</code> there, mirroring the loaded folder
          structure. Coordinates stay <b>true world</b> (Z-up, never recentered), so a re-import lands exactly on top of
          the source models. Import the files back through the Import Manager (Import TDP) or load them directly.
        </>
      }
    >
      <Button
        icon={<IconBox size={14} />}
        tooltip="Write one merged .tdp per loaded model into a folder you pick: one color group per final color — smallest and fastest to load"
        shortcut="export.tdp"
        onClick={() => void act.exportTdp('merged')}
      >
        Export merged TDP (per color)
      </Button>
      <Button
        icon={<IconSitemap size={14} />}
        tooltip="Write one .tdp per loaded model into a folder you pick, keeping each model's item hierarchy as named entries"
        shortcut="export.tdpHierarchy"
        onClick={() => void act.exportTdp('hierarchy')}
      >
        Export hierarchy TDP
      </Button>
    </Collapsible>
  );
}
