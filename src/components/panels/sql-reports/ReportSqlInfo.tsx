import { InfoButton } from '@treDeSpaceUI/widgets';

/** The "How report SQL runs" popover — the SQL label row of the Reports
 *  editor and the SQL Editor share it, so the scratch-table idioms are told
 *  once. */
export function ReportSqlInfo() {
  return (
    <span className="flex items-center gap-1.5 text-slate-400 text-xs">
      SQL — drag the bottom-right corner to resize
      <InfoButton label="How report SQL runs">
        The last SQL statement is the report query; earlier statements run as setup. Use{' '}
        <code>SELECT v FROM FILTER_ARGS WHERE k='key'</code> for a filter, and (Detail){' '}
        <code>SELECT FULLNAME FROM TREE_VIEW_ARGS</code> for the clicked hierarchy. In a Detail form, http(s) values
        show as links and a JSON-array column —{' '}
        <code>json_group_array(json_object(label, value, value_link_label))</code> — flattens into one field per
        element.
      </InfoButton>
    </span>
  );
}
