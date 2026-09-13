import { IconListCheck, IconMapPinPlus, IconPalette, IconRuler } from '@tabler/icons-react';
import { Badge, Button, Collapsible, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import type { Viewpoint } from '../../../state/viewer/viewpoints.state';
import { ViewpointRowActions } from './ViewpointRowActions';

/** One viewpoint's editor row: actions, name/description, copy-into buttons
 *  and the selected-on-activation fullname list. */
export function ViewpointRow({
  vp,
  active,
  expanded,
  idx,
  total,
}: {
  vp: Viewpoint;
  active: boolean;
  expanded: boolean;
  idx: number;
  total: number;
}) {
  return (
    <Collapsible
      open={expanded}
      onToggle={(next) => act.select(next ? vp.id : null)}
      title={
        <span className={active ? 'text-blue-300' : undefined}>
          {vp.name}
          {active ? ' — active' : ''}
        </span>
      }
      aside={
        <Badge tooltip="Labels · Measurements · Selected fullnames stored in this viewpoint">
          {vp.labels.length}L {vp.measurements.length}M {vp.fullnames.length}S
        </Badge>
      }
    >
      <ViewpointRowActions vpId={vp.id} idx={idx} total={total} />

      <TextInput
        label="Name"
        labelPosition="left"
        labelWidth={64}
        value={vp.name}
        onChange={(v) => act.setName(vp.id, v)}
        placeholder="Viewpoint name"
      />
      <TextArea
        label="Description — **bold** and newlines render in the viewer"
        value={vp.description}
        rows={3}
        placeholder="What this viewpoint shows…"
        onChange={(v) => act.setDescription(vp.id, v)}
      />
      <div className="mt-1 text-slate-400 text-xs">Copy into this viewpoint</div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          icon={<IconMapPinPlus size={14} />}
          tooltip="Copy the scene Labels panel's labels into this viewpoint — overrides the viewpoint's labels"
          shortcut="viewpoints.addLabels"
          onClick={() => act.copySceneLabels(vp.id)}
        >
          Copy labels
        </Button>
        <Button
          icon={<IconRuler size={14} />}
          tooltip="Copy the scene Measurements panel's measurements into this viewpoint — overrides the viewpoint's measurements"
          shortcut="viewpoints.addMeasurements"
          onClick={() => act.copySceneMeasurements(vp.id)}
        >
          Copy measurements
        </Button>
        <Button
          icon={<IconPalette size={14} />}
          tooltip="Copy the global Set Color editor's rules into this viewpoint — overrides the viewpoint's rules"
          shortcut="viewpoints.addSetColors"
          onClick={() => act.copyGlobalRules(vp.id)}
        >
          Copy set colors
        </Button>
      </div>

      <TextArea
        label="Selected on activation — one fullname per line"
        value={vp.fullnames.join('\n')}
        rows={3}
        placeholder="/SITE/ZONE/PIPE-01&#10;/SITE/ZONE/PIPE-02"
        onChange={(v) => act.setFullnames(vp.id, v)}
      />
      <Button
        icon={<IconListCheck size={14} />}
        tooltip="Fill the list from the currently selected items (selection roots)"
        shortcut="viewpoints.fromSelection"
        onClick={() => void act.fullnamesFromSelection(vp.id)}
      >
        From selection
      </Button>
    </Collapsible>
  );
}
