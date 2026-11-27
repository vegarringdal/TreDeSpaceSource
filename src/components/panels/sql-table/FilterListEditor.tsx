import { Button, PickerPopover, type PopoverAnchor } from '@treDeSpaceUI/widgets';
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { listValues, uniqueValues } from './filterOperators';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type FilterListEditorProps = Readonly<{
  /** The filter cell's popover anchor; mount this only while it is open. */
  anchor: PopoverAnchor;
  column: string;
  isNotIn: boolean;
  /** The filter's text when the editor opened (one value per line). */
  text: string;
  /** Every edit, so the table follows as you type. */
  onChange: (text: string) => void;
  /** Done or Escape (an outside press closes through the anchor itself). */
  onClose: () => void;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const EDITOR_WIDTH = 300;
const PLACEHOLDER = 'Paste cells from a spreadsheet, or type one value per line';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function describeCount(values: readonly string[]): string {
  const unique = uniqueValues(values).length;
  const repeated = values.length - unique;
  const count = `${unique.toLocaleString()} value${unique === 1 ? '' : 's'}`;

  return repeated ? `${count} (${repeated.toLocaleString()} repeated)` : count;
}

/** The in-list filter's editor: a resizable box under the filter cell with
 *  one value per line. The table follows every keystroke; repeats are
 *  counted while editing and gone the next time it opens. */
export function FilterListEditor({ anchor, column, isNotIn, text, onChange, onClose }: FilterListEditorProps) {
  const [draft, setDraft] = useState(() => uniqueValues(listValues(text)).join('\n'));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const update = (next: string): void => {
    setDraft(next);
    onChange(next);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => update(e.target.value);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const handleClear = (): void => {
    update('');
    textareaRef.current?.focus();
  };

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // open with the caret after the last value, ready to add one
  useEffect(() => {
    const ta = textareaRef.current;
    ta?.focus();
    ta?.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PickerPopover anchor={anchor} width={EDITOR_WIDTH}>
      <div role="dialog" aria-label={`${column} list`} className="grid gap-1.5 p-1.5">
        <div className="flex items-baseline gap-2">
          <b className="font-semibold text-slate-100">{column}</b>
          <span className="text-slate-400">{isNotIn ? 'not in list' : 'in list'} · one value per line</span>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          className="h-40 min-h-20 w-[286px] min-w-48 resize border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[11px] text-slate-200 leading-normal outline-none placeholder:text-slate-500 focus:border-blue-400"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center gap-1.5">
          <span className="mr-auto text-slate-400 tabular-nums">{describeCount(listValues(draft))}</span>
          <Button size="sm" onClick={handleClear}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </PickerPopover>
  );
}
