import { IconPlus, IconX } from '@tabler/icons-react';
import { Button, Select, type SelectOption, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import type { FilterRow } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';

const OP_OPTIONS: readonly SelectOption<FilterRow['op']>[] = [
  { value: 'append', label: 'Append' },
  { value: 'remove', label: 'Remove' },
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

const VALUE_PLACEHOLDERS: Record<Exclude<FilterRow['mode'], 'multi'>, string> = {
  contains: 'Text the name must contain; blank = everything',
  single: 'Name — equals; *x* contains, x* starts with, *x ends with; blank = everything',
  starts: 'Text the name must start with; blank = everything',
  ends: 'Text the name must end with; blank = everything',
  wildcard: 'Name with * wildcards anywhere — /85*pump*01; blank = everything',
};

/** One filter row of a color rule: op, match mode, comment and the pattern. */
export function FilterRowEditor({ ruleIdx, idx, row }: { ruleIdx: number; idx: number; row: FilterRow }) {
  const { act } = useContext(MultiColorCtx);

  return (
    <div className="flex flex-col gap-1 rounded border border-neutral-700/60 p-1">
      <div className="flex items-center gap-1">
        <Button
          iconOnly
          icon={<IconPlus size={14} />}
          tooltip="Insert the LAST selected name — whatever is the current selection root: the row you clicked in the tree, the item you picked in the viewport, or where U / P walked to. Replaces this row's text; in Multi mode it is appended as a new line instead"
          onClick={() => void act.insertSelectedName(ruleIdx, idx)}
        />
        <Select
          className="min-w-0 flex-1"
          tooltip="Append adds this row's matches to the rule's result; Remove subtracts them from the rows above"
          options={OP_OPTIONS}
          value={row.op}
          onChange={(op) => {
            if (op) {
              act.updateFilter(ruleIdx, idx, { op });
            }
          }}
        />
        <Select
          className="min-w-0 flex-1"
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
          tooltip="The filter is applied to the NAMES at this hierarchy level (counted like the tree, import folders included) — each match includes its whole subtree. Lvl 1 tests the import folder name, so a hit takes everything under the folder. All lvl = match at any level"
          options={LEVEL_OPTIONS}
          value={String(row.level)}
          onChange={(v) => act.updateFilter(ruleIdx, idx, { level: Number(v ?? '') || 0 })}
        />
        <Button
          iconOnly
          icon={<IconX size={14} />}
          tooltip="Remove this filter row"
          onClick={() => act.removeFilter(ruleIdx, idx)}
        />
      </div>
      {row.mode === 'multi' ? (
        <TextArea
          value={row.value}
          rows={4}
          placeholder={
            'Paste names — one per line (equals, case-insensitive). A trailing color sets that line’s color: name #ff0000, name yellow, or name,red'
          }
          onChange={(v) => act.updateFilter(ruleIdx, idx, { value: v })}
        />
      ) : (
        <TextInput
          value={row.value}
          placeholder={VALUE_PLACEHOLDERS[row.mode]}
          onChange={(v) => act.updateFilter(ruleIdx, idx, { value: v })}
        />
      )}
      <TextInput
        value={row.comment}
        placeholder="Comment"
        onChange={(v) => act.updateFilter(ruleIdx, idx, { comment: v })}
      />
    </div>
  );
}
