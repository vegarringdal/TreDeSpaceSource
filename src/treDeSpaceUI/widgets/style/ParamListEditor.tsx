import { IconArrowDown, IconArrowUp, IconPlus, IconX } from '@tabler/icons-react';
import { Button } from '../Button';
import { Select } from '../select/Select';
import { TextInput } from '../text/TextField';
import { uniqueParamKey } from './paramKey';

/** The minimum a parameter row needs: a key, a label and a type. */
export interface ParamLike {
  /** Unique key — used as {{key}} in texts; typed keys are sanitised to letters, digits and `_`. */
  key: string;
  /** Caption shown in the value form. */
  label: string;
  /** One of the editor's `types` values. */
  type: string;
}

export interface ParamListEditorProps<P extends ParamLike> {
  /** The parameters, in order. */
  value: readonly P[];
  /** Receives the whole new list after any edit. */
  onChange: (value: P[]) => void;
  /** The types a parameter can have; Add uses the first (and is off while there are none). */
  types: readonly { value: P['type']; label: string }[];
  /** A fresh parameter of a type (its default value) — for Add and on a retype, which keeps the label. */
  make: (type: P['type'], key: string) => P;
  /** Grey out every row and the Add button. */
  disabled?: boolean;
  /** Extra classes on the outer element. */
  className?: string;
}

/** An editable list of named, typed parameters: key, label, type; reorder,
 *  remove, add. Keys stay unique (a clash gets a number) and clean (anything
 *  but letters, digits and `_` becomes `_`). */
export function ParamListEditor<P extends ParamLike>({
  value,
  onChange,
  types,
  make,
  disabled = false,
  className = '',
}: ParamListEditorProps<P>) {
  const set = (i: number, p: P) => onChange(value.map((x, k) => (k === i ? p : x)));
  const keysBesides = (i: number) => value.filter((_, k) => k !== i).map((x) => x.key);
  const add = () => {
    const first = types[0];
    if (first) {
      onChange([...value, make(first.value, uniqueParamKey('param', keysBesides(-1)))]);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) {
      return;
    }
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className={className}>
      {value.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while a key is being edited
        <div key={`${p.key}-${i}`} className="mb-1 grid grid-cols-[1fr_1fr_auto] items-center gap-1">
          <TextInput
            value={p.key}
            clearable={false}
            disabled={disabled}
            tooltip="Key — used as {{key}} in texts"
            onChange={(k) => set(i, { ...p, key: uniqueParamKey(k, keysBesides(i)) })}
          />
          <TextInput
            value={p.label}
            clearable={false}
            disabled={disabled}
            tooltip="Label shown in the value form"
            onChange={(label) => set(i, { ...p, label })}
          />
          <div className="flex items-center">
            <Select
              className="w-24"
              value={p.type}
              options={types}
              clearable={false}
              disabled={disabled}
              onChange={(t) => t && set(i, { ...make(t, p.key), label: p.label })}
            />
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              icon={<IconArrowUp />}
              tooltip="Up"
              disabled={disabled}
              onClick={() => move(i, -1)}
            />
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              icon={<IconArrowDown />}
              tooltip="Down"
              disabled={disabled}
              onClick={() => move(i, 1)}
            />
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              icon={<IconX />}
              tooltip="Remove"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, k) => k !== i))}
            />
          </div>
        </div>
      ))}
      <Button size="sm" icon={<IconPlus />} disabled={disabled || types.length === 0} onClick={add}>
        Add parameter
      </Button>
    </div>
  );
}
