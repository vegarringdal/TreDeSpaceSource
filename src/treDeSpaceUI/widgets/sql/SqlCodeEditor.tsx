import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { EDITOR_TEXT, highlightSql } from './sqlHighlight';

// A small SQL code editor with no dependencies: a transparent <textarea> sits
// exactly on top of a highlighted <pre>, and a gutter counts the lines.

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
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRun?.();
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const ta = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = ta;
              onChange(`${value.slice(0, a)}  ${value.slice(b)}`);
              requestAnimationFrame(() => ta.setSelectionRange(a + 2, a + 2));
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
