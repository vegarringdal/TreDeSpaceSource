import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';
import { Button, InlinePanel, Select, TextInput } from '@treDeSpaceUI/widgets';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';
import { DropdownFilterFields } from './DropdownFilterFields';

type FilterEditRowProps = Readonly<{
  report: ReportDef;
  filter: ReportFilter;
  /** Position in the list — the "Filter #N" title when there is no label. */
  index: number;
  isFirst: boolean;
  isLast: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onChange: (p: Partial<ReportFilter>) => void;
  onRemove: () => void;
  /** Swap with the neighbour above (-1) or below (1). */
  onMove: (dir: -1 | 1) => void;
}>;

/** Header buttons one notch smaller than the default, so the dense header
 *  stays a single tight line. */
const ACTION_BUTTON = 'h-5 w-5';

/** One filter's editor: a collapsible section titled by the filter's label
 *  (or "Filter #N"), with move up / down and remove in its header. Dropdown
 *  filters get a resizable SQL editor AND a live test dropdown driven by that
 *  SQL, so the query can be tried in place. */
export function FilterEditRow({
  report,
  filter: f,
  index,
  isFirst,
  isLast,
  collapsed,
  onToggle,
  onChange,
  onRemove,
  onMove,
}: FilterEditRowProps) {
  const title = f.label.trim() || `Filter #${index + 1}`;
  const actions = (
    <>
      <Button
        iconOnly
        className={ACTION_BUTTON}
        icon={<IconArrowUp size={13} />}
        disabled={isFirst}
        tooltip="Move this filter up (the inputs are shown in this order)"
        onClick={() => onMove(-1)}
      />
      <Button
        iconOnly
        className={ACTION_BUTTON}
        icon={<IconArrowDown size={13} />}
        disabled={isLast}
        tooltip="Move this filter down (the inputs are shown in this order)"
        onClick={() => onMove(1)}
      />
      <Button
        iconOnly
        className={ACTION_BUTTON}
        icon={<IconTrash size={13} />}
        tooltip="Remove this filter"
        onClick={onRemove}
      />
    </>
  );
  return (
    <InlinePanel
      dense
      className="shrink-0"
      title={title}
      titleUppercase={false}
      open={!collapsed}
      onToggle={onToggle}
      actions={actions}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-28 shrink-0">
            <Select
              value={f.kind}
              options={[
                { value: 'INPUT', label: 'Input' },
                { value: 'DROPDOWN', label: 'Dropdown' },
              ]}
              onChange={(v) => onChange({ kind: v === 'DROPDOWN' ? 'DROPDOWN' : 'INPUT' })}
            />
          </div>
          <TextInput value={f.key} placeholder="key (FILTER_ARGS.k)" onChange={(v) => onChange({ key: v })} />
          <TextInput value={f.label} placeholder="Label" onChange={(v) => onChange({ label: v })} />
        </div>
        {f.kind === 'INPUT' ? (
          <TextInput
            value={f.value ?? ''}
            placeholder="Default value (optional)"
            onChange={(v) => onChange({ value: v })}
          />
        ) : (
          <DropdownFilterFields report={report} filter={f} onChange={onChange} />
        )}
      </div>
    </InlinePanel>
  );
}
