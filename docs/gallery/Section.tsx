import type { ReactNode } from 'react';
import { Code } from './Code';
import { TypeCard } from './TypeCard';

/** One gallery section: intro, live demo, usage snippet, props reference. */
export function Section({
  title,
  note,
  code,
  props,
  children,
}: {
  title: string;
  note: ReactNode;
  code: string;
  props?: string[];
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="m-0 mb-1 font-semibold text-[15px] text-slate-100">{title}</h2>
      <p className="m-0 mb-4 max-w-[70ch] text-slate-400">{note}</p>
      <div className="max-w-[640px]">{children}</div>
      <h3 className="mt-5 mb-1.5 font-semibold text-[11px] text-slate-500 uppercase tracking-wider">Usage</h3>
      <Code>{code}</Code>
      {props && props.length > 0 && (
        <>
          <h3 className="mt-5 mb-1.5 font-semibold text-[11px] text-slate-500 uppercase tracking-wider">
            Props <span className="font-normal normal-case tracking-normal">· generated from the source</span>
          </h3>
          {props.map((n) => (
            <TypeCard key={n} name={n} />
          ))}
        </>
      )}
    </div>
  );
}
