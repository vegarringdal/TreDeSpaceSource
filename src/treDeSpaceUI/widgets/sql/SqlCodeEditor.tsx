import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { indentSelection, newlineKeepIndent, outdentSelection, type TextEdit } from './sqlEditKeys';
import { EDITOR_TEXT, highlightSql } from './sqlHighlight';

// A small SQL code editor with no dependencies: a transparent <textarea> sits
// exactly on top of a highlighted <pre>, and a gutter counts the lines.
// Editor keys: Tab / Shift+Tab indent and outdent the selected lines, Enter
// keeps the indentation, Ctrl/Cmd+Enter runs.

/** Apply a text edit through the browser's own insert command so it lands on
 *  the textarea's native undo stack (Ctrl+Z still works); falls back to
 *  setRangeText where execCommand is unavailable. */
function applyEdit(ta: HTMLTextAreaElement, edit: TextEdit, onChange: (v: string) => void): void {
  ta.setSelectionRange(edit.replaceStart, edit.replaceEnd);
  const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.text);
  if (!inserted) {
    ta.setRangeText(edit.text, edit.replaceStart, edit.replaceEnd, 'end');
    onChange(ta.value);
  }
  // synchronously — the DOM value is already updated, and a deferred restore
  // would jump the caret back under keys typed in the meantime
  ta.setSelectionRange(edit.selStart, edit.selEnd);
}

export interface SqlCodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** Ctrl/Cmd+Enter inside the editor. */
  onRun?: () => void;
  /** Current caret selection (start/end char offsets) — lets the host run only
   *  the highlighted text. */
  onSelect?: (start: number, end: number) => void;
  /** Show a drag handle so the user can resize the editor's height (the
   *  caller sets the starting height via className, e.g. "h-32"). */
  resizable?: boolean;
  className?: string;
}

/** The editor. Scroll position is mirrored from the textarea onto the
 *  highlight layer and the gutter, so all three stay glued together. */
export function SqlCodeEditor({ value, onChange, onRun, onSelect, resizable, className }: SqlCodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) {
      return;
    }
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  };
  useLayoutEffect(syncScroll, []);

  return (
    <div
      className={cn(
        'flex min-h-0 border border-slate-800 bg-slate-950',
        resizable && 'resize-y overflow-hidden',
        className,
      )}
    >
      <div
        ref={gutterRef}
        className={cn(
          EDITOR_TEXT,
          'select-none overflow-hidden border-slate-800 border-r bg-slate-900/60 px-1.5 py-1 text-right text-slate-600',
        )}
      >
        {Array.from({ length: lines }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: line numbers ARE the index
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className={cn(EDITOR_TEXT, 'absolute inset-0 overflow-hidden p-1 text-slate-200')}
        >
          {highlightSql(value)}
          {'\n'}
        </pre>
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onSelect={(e) => onSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
          onKeyDown={(e) => {
            const ta = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = ta;
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRun?.();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              applyEdit(ta, newlineKeepIndent(ta.value, a, b), onChange);
              return;
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const edit = e.shiftKey ? outdentSelection(ta.value, a, b) : indentSelection(ta.value, a, b);
              if (edit) {
                applyEdit(ta, edit, onChange);
              }
            }
          }}
          className={cn(
            EDITOR_TEXT,
            'absolute inset-0 h-full w-full resize-none bg-transparent p-1 text-transparent caret-slate-100 outline-none',
          )}
        />
      </div>
    </div>
  );
}
