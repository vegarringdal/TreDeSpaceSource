import { Link } from '@treDeSpaceUI/widgets';
import { type DetailField, isEmptyValue } from './detailFields';

/** One field's value cell: a link for http(s) values (new tab, no opener —
 *  the URL itself is the tooltip), a muted "null" for empty values, the text
 *  otherwise. */
export function DetailValue({ field }: { field: DetailField }) {
  if (field.href) {
    return (
      <Link href={field.href} tooltip={field.href}>
        {field.linkLabel}
      </Link>
    );
  }
  if (isEmptyValue(field.val)) {
    return <span className="text-slate-600">null</span>;
  }
  return <>{String(field.val)}</>;
}
