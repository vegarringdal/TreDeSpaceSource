import { type DetailField, isEmptyValue } from './detailFields';

/** One field's value cell: a link for http(s) values (new tab, no opener —
 *  the URL itself is the tooltip), a muted "null" for empty values, the text
 *  otherwise. */
export function DetailValue({ field }: { field: DetailField }) {
  if (field.href) {
    return (
      <a
        href={field.href}
        target="_blank"
        rel="noopener noreferrer"
        title={field.href}
        className="text-sky-400 underline decoration-sky-400/50 hover:text-sky-300"
      >
        {field.linkLabel}
      </a>
    );
  }
  if (isEmptyValue(field.val)) {
    return <span className="text-slate-600">null</span>;
  }
  return <>{String(field.val)}</>;
}
