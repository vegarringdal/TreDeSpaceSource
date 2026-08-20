import { hl } from './hlCode';

/** Highlighted code block for the gallery's usage snippets. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="m-0 max-w-[640px] overflow-x-auto rounded border border-slate-800 bg-slate-900 p-3 font-mono text-[11.5px] text-slate-300 leading-relaxed">
      {hl(children)}
    </pre>
  );
}
