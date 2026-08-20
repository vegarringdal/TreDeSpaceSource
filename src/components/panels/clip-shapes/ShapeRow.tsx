import {
  IconBox,
  IconCircle,
  IconCircleHalf2,
  IconCylinder,
  IconFocusCentered,
  IconHandMove,
  IconMaximize,
  IconPower,
  IconTrash,
  IconVectorTriangle,
} from '@tabler/icons-react';
import { Button, Collapsible, NumberInput, TextInput } from '@treDeSpaceUI/widgets';
import { clipShapesActions as act } from '../../../state/viewer/clipShapes.actions';
import { type ClipShape, displayName } from '../../../state/viewer/clipShapes.state';
import { fitTarget, setAxis } from './clipShapeFit';

const KIND_ICON = { sphere: IconCircle, cylinder: IconCylinder, box: IconBox } as const;

/** One clip-shape editor block: name, toggles, fit and per-axis numbers. */
export function ShapeRow({ s, armed }: { s: ClipShape; armed: boolean }) {
  const Icon = KIND_ICON[s.kind];
  const num = (v: number, on: (x: number) => void, step = 0.5) => <NumberInput value={v} step={step} onChange={on} />;

  const fit = async (padM: number) => {
    const t = await fitTarget();
    if (t) {
      act.fit(s.id, t.mn, t.mx, padM);
    }
  };

  const center = async () => {
    const t = await fitTarget();
    if (t) {
      act.centerOn(s.id, t.mn, t.mx);
    }
  };

  return (
    <Collapsible
      title={displayName(s)}
      aside={<span className={s.enabled ? '' : 'text-slate-600'}>{s.enabled ? s.kind : 'off'}</span>}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={16} className="shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <TextInput value={s.label} onChange={(v) => act.update(s.id, { label: v })} placeholder="(name)" />
          </div>
          <Button
            iconOnly
            active={s.enabled}
            onClick={() => act.toggleEnabled(s.id)}
            tooltip={s.enabled ? 'Disable this shape' : 'Enable this shape'}
          >
            <IconPower size={14} />
          </Button>
          <Button
            iconOnly
            active={s.inverted}
            onClick={() => act.toggleInverted(s.id)}
            tooltip="Invert — clip INSIDE the shape (cut a hole)"
          >
            <IconCircleHalf2 size={14} />
          </Button>
          <Button
            iconOnly
            active={s.showHelper}
            onClick={() => act.toggleHelper(s.id)}
            tooltip="Show this shape's outline"
          >
            <IconVectorTriangle size={14} />
          </Button>
          <Button
            iconOnly
            active={armed}
            onClick={() => act.armGizmo(s.id)}
            tooltip="Arm the viewport gizmo on this shape (move / rotate / scale)"
          >
            <IconHandMove size={14} />
          </Button>
          <Button iconOnly onClick={() => act.remove(s.id)} tooltip="Delete this shape">
            <IconTrash size={14} />
          </Button>
        </div>

        <div className="grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1 text-[11px] text-slate-400">
          <span>Fit</span>
          <Button
            icon={<IconMaximize size={13} />}
            onClick={() => void fit(0)}
            tooltip="Fit the selection (or scene) exactly"
          >
            Sel
          </Button>
          <Button
            icon={<IconMaximize size={13} />}
            onClick={() => void fit(2)}
            tooltip="Fit the selection (or scene) + 2 m padding"
          >
            +2m
          </Button>
          <Button
            icon={<IconFocusCentered size={13} />}
            onClick={() => void center()}
            tooltip="Move to the selection (or scene) centre, keeping size"
          >
            Center
          </Button>
          <span>Center</span>
          {([0, 1, 2] as const).map((ax) => (
            <div key={ax}>{num(s.center[ax], (x) => act.update(s.id, { center: setAxis(s.center, ax, x) }))}</div>
          ))}
          {s.kind === 'box' ? (
            <>
              <span>Size</span>
              {([0, 1, 2] as const).map((ax) => (
                <div key={ax}>
                  {num(s.halfExtents[ax], (x) =>
                    act.update(s.id, { halfExtents: setAxis(s.halfExtents, ax, Math.max(0.01, x)) }),
                  )}
                </div>
              ))}
            </>
          ) : (
            <>
              <span>Radius</span>
              <div>{num(s.radius, (x) => act.update(s.id, { radius: Math.max(0.01, x) }))}</div>
              {s.kind === 'cylinder' ? (
                <>
                  <span className="col-span-1 text-right">Height</span>
                  <div>{num(s.height, (x) => act.update(s.id, { height: Math.max(0.01, x) }))}</div>
                </>
              ) : (
                <span className="col-span-2" />
              )}
            </>
          )}
          {s.kind === 'cylinder' && (
            <>
              <span>Axis</span>
              {([0, 1, 2] as const).map((ax) => (
                <div key={ax}>{num(s.axis[ax], (x) => act.update(s.id, { axis: setAxis(s.axis, ax, x) }), 0.1)}</div>
              ))}
            </>
          )}
        </div>
      </div>
    </Collapsible>
  );
}
