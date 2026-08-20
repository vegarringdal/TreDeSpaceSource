import { IconArrowDown, IconArrowUp, IconPlus, IconRowInsertTop, IconX } from '@tabler/icons-react';
import { Button, Collapsible, ColorSelect, NumberInput, Select, TextInput } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { useLoadedStores } from '../../../state/viewer/storeScope';
import { FilterRowEditor } from './FilterRowEditor';
import type { ColorRule } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';
import { Tip } from './Tip';

const COLOR_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
];

/** One color rule: name/order/enable controls, color + opacity, filter rows. */
export function RuleEditor({
  idx,
  rule,
  count,
  total,
}: {
  idx: number;
  rule: ColorRule;
  count: number | null;
  total: number;
}) {
  const { act } = useContext(MultiColorCtx);
  const loadedStores = useLoadedStores();
  const storeOptions = [
    { value: '', label: 'All stores' },
    // only stores with models in the scene; keep a rule file's pick
    // selectable even when that store isn't loaded (it matches nothing)
    ...loadedStores.map((s) => ({ value: s, label: s })),
    ...(rule.store && !loadedStores.includes(rule.store) ? [{ value: rule.store, label: rule.store }] : []),
  ];

  return (
    <Collapsible
      title={
        <span className={rule.enabled ? undefined : 'text-red-400'}>
          #{idx + 1} {rule.comment || 'Rule'}
          {rule.enabled ? '' : ' — disabled'}
        </span>
      }
      aside={count != null ? `${count} matched` : undefined}
      defaultOpen
    >
      <div className="flex items-center gap-1">
        <TextInput
          className="min-w-0 flex-1"
          value={rule.comment}
          placeholder="Rule Name"
          onChange={(v) => act.updateRule(idx, { comment: v })}
        />
        <Button
          iconOnly
          icon={<IconRowInsertTop size={14} />}
          tooltip="Insert a new rule BEFORE this one"
          onClick={() => act.insertRuleBefore(idx)}
        />
        <Button
          iconOnly
          icon={<IconArrowUp size={14} />}
          disabled={idx === 0}
          tooltip="Move this rule up (rules run top to bottom)"
          onClick={() => act.moveRule(idx, -1)}
        />
        <Button
          iconOnly
          icon={<IconArrowDown size={14} />}
          disabled={idx === total - 1}
          tooltip="Move this rule down (rules run top to bottom)"
          onClick={() => act.moveRule(idx, 1)}
        />
        <Button
          active={rule.enabled}
          tooltip="Enable / disable this rule — disabled rules are skipped by Run"
          onClick={() => act.toggleRule(idx)}
        >
          {rule.enabled ? 'On' : 'Off'}
        </Button>
        <Button iconOnly icon={<IconX size={14} />} tooltip="Delete this rule" onClick={() => act.removeRule(idx)} />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Color</span>
        <Tip className="w-28 shrink-0" tip="Default restores the original mesh color; Custom applies the picked color">
          <Select
            options={COLOR_OPTIONS}
            value={rule.color == null ? 'default' : 'custom'}
            onChange={(v) => act.updateRule(idx, { color: v === 'default' ? null : (rule.color ?? '#ff8800') })}
          />
        </Tip>
        {rule.color != null && (
          <div className="min-w-0 flex-1">
            <ColorSelect value={rule.color} onChange={(c) => act.updateRule(idx, { color: c })} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Opacity</span>
        <div className="w-28">
          <NumberInput
            value={rule.opacity}
            min={0}
            max={1}
            step={0.05}
            precision={2}
            onChange={(v) => act.updateRule(idx, { opacity: v })}
          />
        </div>
        <Button
          active={rule.opacity === 0}
          tooltip="Quick set: opacity 0 — matched items become hidden"
          onClick={() => act.updateRule(idx, { opacity: 0 })}
        >
          0
        </Button>
        <Button
          active={rule.opacity === 1}
          tooltip="Quick set: opacity 1 — fully opaque (default)"
          onClick={() => act.updateRule(idx, { opacity: 1 })}
        >
          1
        </Button>
        {rule.opacity === 1 && <span className="text-neutral-500 text-xs">opaque</span>}
        {rule.opacity === 0 && <span className="text-neutral-500 text-xs">hidden</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Store</span>
        <Tip
          className="w-28 shrink-0"
          tip="Scope this rule to models loaded from one store — All stores matches every loaded model"
        >
          <Select options={storeOptions} value={rule.store} onChange={(v) => act.updateRule(idx, { store: v ?? '' })} />
        </Tip>
        {rule.store !== '' && <span className="text-neutral-500 text-xs">only models from this store</span>}
      </div>

      {rule.filters.map((row, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <FilterRowEditor key={j} ruleIdx={idx} idx={j} row={row} />
      ))}
      <Button icon={<IconPlus size={14} />} tooltip="Add a filter row to this rule" onClick={() => act.addFilter(idx)}>
        Add filter
      </Button>
    </Collapsible>
  );
}
