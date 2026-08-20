// Generated props reference — the data comes from scripts/gen-widget-docs.mjs
// via docs/generated/widgetData.json (no drift).
import widgetData from '../generated/widgetData.json';
import { hl } from './hlCode';

interface FieldInfo {
  text: string;
  doc: string;
}
interface TypeInfo {
  doc: string;
  extends: string | null;
  fields: FieldInfo[];
}
const TYPES: Record<string, TypeInfo> = widgetData.types;
const ALIASES: Record<string, { doc: string; def: string }> = widgetData.aliases;

/** Reference card for one library interface or type alias, from the generated data. */
export function TypeCard({ name }: { name: string }) {
  const t = TYPES[name];
  const a = ALIASES[name];
  if (!t && !a) {
    return null;
  }
  return (
    <div className="mt-3 max-w-[640px] rounded border border-slate-800">
      <div className="border-slate-800 border-b bg-slate-900 px-3 py-1.5 font-mono text-[11.5px]">
        <span className="hl-kw">{t ? 'interface' : 'type'}</span> <span className="hl-ty">{name}</span>
        {t?.extends && (
          <>
            {' '}
            <span className="hl-kw">extends</span> {hl(t.extends)}
          </>
        )}
        {a && <> = {hl(a.def)}</>}
      </div>
      {(t?.doc || a?.doc) && (
        <p className="m-0 border-slate-800 border-b px-3 py-1.5 text-slate-400">{t?.doc ?? a?.doc}</p>
      )}
      {t && (
        <div className="px-3 py-1.5">
          {t.fields.map((f) => (
            <div key={f.text} className="py-1">
              <code className="font-mono text-[11.5px]">{hl(f.text)}</code>
              {f.doc && <div className="mt-0.5 max-w-[60ch] text-slate-500">{f.doc}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
