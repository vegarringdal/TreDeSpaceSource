import { IconBraces } from '@tabler/icons-react';
import { type ReactNode, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { Labelled } from '../fieldChrome';
import { Menu } from '../menu/Menu';

export interface TemplateTextInputProps {
  /** text with {{placeholders}} */
  value: string;
  /** Receives the text on every edit and after an insert from the {} menu. */
  onChange: (value: string) => void;
  /** placeholders offered by the {} menu and highlighted when known */
  placeholders: readonly { key: string; label: string }[];
  /** a textarea instead of one line */
  multiline?: boolean;
  /** Caption above the field. */
  label?: ReactNode;
  /** Dimmed text while empty. */
  placeholder?: string;
  /** Grey out the field and its {} button. */
  disabled?: boolean;
  /** Extra classes on the outermost element (the labelled block). */
  className?: string;
}

const PLACEHOLDER_RE = /(\{\{\s*[\w.]+\s*\}\})/g;

/**
 * A text field for templates: {{key}} placeholders are highlighted (known
 * ones blue, unknown ones red) under a transparent editor, and the {} button
 * inserts one at the caret (replacing any selection).
 */
export function TemplateTextInput({
  value,
  onChange,
  placeholders,
  multiline = false,
  label,
  placeholder,
  disabled = false,
  className = '',
}: TemplateTextInputProps) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const known = new Set(placeholders.map((p) => p.key));

  const insert = (key: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(`${value.slice(0, at)}{{${key}}}${value.slice(end)}`);
    requestAnimationFrame(() => el?.focus());
  };

  const highlighted = value.split(PLACEHOLDER_RE).map((part, i) => {
    const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(part);
    if (!m) {
      // biome-ignore lint/suspicious/noArrayIndexKey: split segments are positional
      return <span key={`${i}-${part}`}>{part}</span>;
    }
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: split segments are positional
        key={`${i}-${part}`}
        className={known.has(m[1]) ? 'bg-blue-950 text-blue-300' : 'bg-red-950 text-red-300'}
      >
        {part}
      </span>
    );
  });
  const box = 'w-full min-w-0 whitespace-pre-wrap break-words border px-2 py-1 font-mono text-xs leading-[1.4]';
  const Field = multiline ? 'textarea' : 'input';

  return (
    <Labelled label={label} disabled={disabled} className={className}>
      <div className="relative flex items-start gap-1">
        <div className="relative min-w-0 flex-1">
          <div
            aria-hidden="true"
            className={cn(
              box,
              'pointer-events-none absolute inset-0 overflow-hidden border-transparent text-slate-200',
              !multiline && 'whitespace-pre',
            )}
          >
            {highlighted}
            {'​'}
          </div>
          <Field
            ref={ref}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            rows={multiline ? 3 : undefined}
            spellCheck={false}
            className={cn(
              box,
              'relative resize-y border-slate-700 bg-transparent text-transparent caret-slate-200 outline-none focus:border-blue-400',
            )}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={disabled}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          data-tooltip="Insert a placeholder"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAnchor({ x: r.left, y: r.bottom + 2 });
          }}
        >
          <IconBraces size={13} />
        </button>
      </div>
      <Menu
        anchor={anchor}
        onClose={() => setAnchor(null)}
        items={placeholders.map((p) => ({
          id: p.key,
          label: `${p.label} — {{${p.key}}}`,
          onSelect: () => insert(p.key),
        }))}
      />
    </Labelled>
  );
}
