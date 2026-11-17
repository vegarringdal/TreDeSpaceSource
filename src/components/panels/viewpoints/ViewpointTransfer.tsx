import { IconArrowBackUp, IconArrowBarToLeft, IconMapPinPlus, IconPalette, IconRuler } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { Fragment, type ReactNode } from 'react';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { type TransferKind, viewpointsState } from '../../../state/viewer/viewpoints.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type TransferRow = Readonly<{
  kind: TransferKind;
  icon: ReactNode;
  get: string;
  ret: string;
  /** What the set is called in the tooltips. */
  what: string;
  /** The main panel's name in the tooltips. */
  panel: string;
  getKey: string;
  retKey: string;
  undoKey: string;
  onGet: (id: string) => void;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ICON_SIZE = 14;

const ROWS: readonly TransferRow[] = [
  {
    kind: 'colors',
    icon: <IconPalette size={ICON_SIZE} />,
    get: 'Get color set',
    ret: 'Return color set',
    what: 'rules',
    panel: 'Set Color',
    getKey: 'viewpoints.addSetColors',
    retKey: 'viewpoints.returnSetColors',
    undoKey: 'viewpoints.undoSetColors',
    onGet: (id) => act.copyGlobalRules(id),
  },
  {
    kind: 'labels',
    icon: <IconMapPinPlus size={ICON_SIZE} />,
    get: 'Get labels',
    ret: 'Return labels',
    what: 'labels',
    panel: 'Labels',
    getKey: 'viewpoints.addLabels',
    retKey: 'viewpoints.returnLabels',
    undoKey: 'viewpoints.undoLabels',
    onGet: (id) => act.copySceneLabels(id),
  },
  {
    kind: 'measurements',
    icon: <IconRuler size={ICON_SIZE} />,
    get: 'Get measurements',
    ret: 'Return measurements',
    what: 'measurements',
    panel: 'Measurements',
    getKey: 'viewpoints.addMeasurements',
    retKey: 'viewpoints.returnMeasurements',
    undoKey: 'viewpoints.undoMeasurements',
    onGet: (id) => act.copySceneMeasurements(id),
  },
];

/** The viewpoint editor's exchange with the MAIN Labels, Measurements and Set
 *  Color panels (the ones the host API reads and writes): per set, Get
 *  (main → viewpoint), Return (viewpoint → main, confirmed when the main panel
 *  holds something) and Undo of the last of the two. */
export function ViewpointTransfer({ vpId }: Readonly<{ vpId: string }>) {
  const undo = viewpointsState.use().transferUndo[vpId];

  return (
    <>
      <div className="mt-1 text-slate-400 text-xs">Main panels ↔ this viewpoint</div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        {ROWS.map((row) => (
          <Fragment key={row.kind}>
            <Button
              className="w-full"
              icon={row.icon}
              tooltip={`Copy the main ${row.panel} panel's ${row.what} into this viewpoint — replaces the viewpoint's ${row.what}`}
              shortcut={row.getKey}
              onClick={() => row.onGet(vpId)}
            >
              {row.get}
            </Button>
            <Button
              className="w-full"
              icon={<IconArrowBarToLeft size={ICON_SIZE} />}
              tooltip={`Put this viewpoint's saved ${row.what} back into the main ${row.panel} panel, where the host API sees them — asks first when that panel has ${row.what}`}
              shortcut={row.retKey}
              onClick={() => void act.returnToMain(row.kind, vpId)}
            >
              {row.ret}
            </Button>
            <Button
              iconOnly
              icon={<IconArrowBackUp size={ICON_SIZE} />}
              disabled={undo?.[row.kind] === undefined}
              tooltip={`Undo the last Get or Return of ${row.what} on this viewpoint`}
              shortcut={row.undoKey}
              onClick={() => act.undoTransfer(row.kind, vpId)}
            />
          </Fragment>
        ))}
      </div>
    </>
  );
}
