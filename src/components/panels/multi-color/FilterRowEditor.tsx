import { IconArrowDown, IconArrowUp, IconPlus, IconRowInsertTop, IconTrash } from '@tabler/icons-react';
import { Button, Select, type SelectOption, TextInput } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { FilterValueField } from './FilterValueField';
import type { FilterRow } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';

const OP_OPTIONS: readonly SelectOption<FilterRow['op']>[] = [
  { value: 'append', label: 'Append' },
  { value: 'remove', label: 'Remove' },
  { value: 'keep', label: 'Keep' },
];

const LEVEL_OPTIONS: readonly SelectOption[] = [
  { value: '0', label: 'All lvl' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: `Lvl ${i + 1}` })),
];

const MATCH_OPTIONS: readonly SelectOption<FilterRow['mode']>[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'single', label: 'Equals' },
  { value: 'starts', label: 'Starts with' },
  { value: 'ends', label: 'Ends with' },
  { value: 'wildcard', label: 'Wildcard' },
  { value: 'multi', label: 'Multi' },
];

/** One filter row of a color rule: the op dropdown with insert-before / move /
 *  delete on its right, then insert-selected-name + match mode + level, then
 *  the labelled pattern and comment inputs. */
export function FilterRowEditor({
  ruleIdx,
  idx,
  total,
  row,
}: {
  ruleIdx: number;
  idx: number;
  /** Rows in this rule — bounds the move buttons. */
  total: number;
  row: FilterRow;
}) {
  const { act } = useContext(MultiColorCtx);

  return (
    <div className="flex flex-col gap-1 rounded border border-neutral-700/60 p-1">
      <div className="flex items-center gap-1">
        <Select
          className="min-w-0 flex-1"
          clearable={false}
          tooltip="Append adds this row's matches to the rule's result; Remove subtracts them from the rows above; Keep keeps only what the rows above (in this rule) found that this row matches too — e.g. Append a folder, then Keep contains HVAC"
          options={OP_OPTIONS}
          value={row.op}
          onChange={(op) => {
            if (op) {
              act.updateFilter(ruleIdx, idx, { op });
            }
          }}
        />
        <Button
          iconOnly
          icon={<IconRowInsertTop size={14} />}
          tooltip="Insert a new filter row BEFORE this one"
          onClick={() => act.insertFilterBefore(ruleIdx, idx)}
        />
        <Button
          iconOnly
          icon={<IconArrowUp size={14} />}
          disabled={idx === 0}
          tooltip="Move this filter row up (rows run top to bottom — Keep / Remove act on the rows above)"
          onClick={() => act.moveFilter(ruleIdx, idx, -1)}
        />
        <Button
          iconOnly
          icon={<IconArrowDown size={14} />}
          disabled={idx === total - 1}
          tooltip="Move this filter row down (rows run top to bottom — Keep / Remove act on the rows above)"
          onClick={() => act.moveFilter(ruleIdx, idx, 1)}
        />
        <Button
          iconOnly
          icon={<IconTrash size={14} />}
          tooltip="Remove this filter row"
          onClick={() => act.removeFilter(ruleIdx, idx)}
        />
      </div>
      <div className="flex items-center gap-1">
        <Button
          iconOnly
          icon={<IconPlus size={14} />}
          tooltip="Insert the LAST selected name — whatever is the current selection root: the row you clicked in the tree, the item you picked in the viewport, or where U / P walked to. Replaces this row's text; in Multi mode it is appended as a new line instead"
          onClick={() => void act.insertSelectedName(ruleIdx, idx)}
        />
        <Select
          className="min-w-0 flex-1"
          clearable={false}
          tooltip="Contains: name contains the text. Equals: exact name, * wildcard at start/end. Starts/Ends with: name starts/ends with the text. Wildcard: exact name with * wildcards anywhere. Multi: paste one name per line, each matched exactly. All case-insensitive"
          options={MATCH_OPTIONS}
          value={row.mode}
          onChange={(mode) => {
            if (mode) {
              act.updateFilter(ruleIdx, idx, { mode });
            }
          }}
        />
        <Select
          className="min-w-0 flex-1"
          clearable={false}
          tooltip="The filter is applied to the NAMES at this hierarchy level (counted like the tree, import folders included) — each match includes its whole subtree. Lvl 1 tests the import folder name, so a hit takes everything under the folder. All lvl = match at any level, the import folder names included"
          options={LEVEL_OPTIONS}
          value={String(row.level)}
          onChange={(v) => act.updateFilter(ruleIdx, idx, { level: Number(v ?? '') || 0 })}
        />
      </div>
      <FilterValueField ruleIdx={ruleIdx} idx={idx} row={row} />
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Comment</span>
        <TextInput
          className="min-w-0 flex-1"
          value={row.comment}
          placeholder="Comment"
          onChange={(v) => act.updateFilter(ruleIdx, idx, { comment: v })}
        />
      </div>
    </div>
  );
}
