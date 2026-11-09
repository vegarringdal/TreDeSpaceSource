import { Badge, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { type ClipboardEvent, useContext, useMemo } from 'react';
import type { FilterRow } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';
import { MULTI_EDIT_MAX_LINES, multiValuePreview } from './multiValuePreview';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type FilterValueFieldProps = Readonly<{
  ruleIdx: number;
  idx: number;
  row: FilterRow;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const LABEL_CLS = 'w-14 shrink-0 text-neutral-400 text-xs';

const MULTI_PLACEHOLDER =
  'Paste names — one per line (equals, case-insensitive). A trailing color sets that line’s color: name #ff0000, name yellow, or name,red';

const VALUE_PLACEHOLDERS: Record<Exclude<FilterRow['mode'], 'multi'>, string> = {
  contains: 'Text the name must contain; blank = everything',
  single: 'Name — equals; *x* contains, x* starts with, *x ends with; blank = everything',
  starts: 'Text the name must start with; blank = everything',
  ends: 'Text the name must end with; blank = everything',
  wildcard: 'Name with * wildcards anywhere — /85*pump*01; blank = everything',
};

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The labelled Value of a filter row: a textarea for Multi, a line for the
 *  other modes. A value over MULTI_EDIT_MAX_LINES lines (an Add Set Color
 *  list from the SQL Table, or a big paste) shows only its first lines,
 *  read-only, with a note under it — the whole text in one DOM field would
 *  cost megabytes and lag every render. A paste that would cross the limit
 *  never enters the field at all: it goes straight to the rule. The rule
 *  still runs on every line, and ✕ clears the whole value back to an empty,
 *  editable field. */
export function FilterValueField({ ruleIdx, idx, row }: FilterValueFieldProps) {
  const { act } = useContext(MultiColorCtx);
  const preview = useMemo(() => multiValuePreview(row.value), [row.value]);

  const handleChange = (value: string): void => act.updateFilter(ruleIdx, idx, { value });

  // the browser would insert the whole clipboard into the textarea before
  // React could cut it down (seconds of layout for a big list), so a paste
  // that makes the value too long is applied to the rule instead
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>): void => {
    const field = e.target;
    if (!(field instanceof HTMLTextAreaElement)) {
      return;
    }
    const { value, selectionStart, selectionEnd } = field;
    const next = value.slice(0, selectionStart) + e.clipboardData.getData('text') + value.slice(selectionEnd);
    if (!multiValuePreview(next)) {
      return;
    }
    e.preventDefault();
    handleChange(next);
  };

  // labels mirror the rule's Color / Opacity / Store rows (the widget label's
  // grey goes dark in the light theme, this one stays dim)
  if (preview) {
    const shown = MULTI_EDIT_MAX_LINES.toLocaleString();
    const total = preview.lines.toLocaleString();
    const tooltip = `Too many rows for manual edit: ${total} rows. Only the first ${shown} are shown, read-only — the rule still uses all of them. ✕ clears the whole list.`;
    return (
      <div className="flex items-start gap-1.5">
        <span className={`${LABEL_CLS} pt-1.5`}>Value</span>
        <div className="min-w-0 flex-1">
          <TextArea value={preview.head} rows={4} readOnly tooltip={tooltip} onChange={handleChange} />
          {/* a strip under the field, not over it: the panel is narrow and
              a chip on top would cover the names */}
          <Badge tone="warning" tooltip={tooltip} className="flex w-full border-t-0">
            Too many rows for manual edit — first {shown} of {total} shown, read-only
          </Badge>
        </div>
      </div>
    );
  }

  if (row.mode === 'multi') {
    return (
      <div className="flex items-start gap-1.5">
        <span className={`${LABEL_CLS} pt-1.5`}>Value</span>
        <div className="min-w-0 flex-1" onPaste={handlePaste}>
          <TextArea value={row.value} rows={4} placeholder={MULTI_PLACEHOLDER} onChange={handleChange} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={LABEL_CLS}>Value</span>
      <TextInput
        className="min-w-0 flex-1"
        value={row.value}
        placeholder={VALUE_PLACEHOLDERS[row.mode]}
        onChange={handleChange}
      />
    </div>
  );
}
