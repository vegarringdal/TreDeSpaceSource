import { Select, SqlCodeEditor } from '@treDeSpaceUI/widgets';
import type { SqlDbEntry } from '../../../state/sqlAssets/sqlAssets.state';
import type { ReportDef, ReportType } from '../../../state/sqlReports/sqlReports.state';
import { ReportMetaFields } from './ReportMetaFields';
import { ReportSqlInfo } from './ReportSqlInfo';
import { ReportTypeToggles } from './ReportTypeToggles';

type ReportEditorFieldsProps = Readonly<{
  draft: ReportDef;
  dbs: SqlDbEntry[];
  patch: (p: Partial<ReportDef>) => void;
  toggleType: (t: ReportType) => void;
}>;

/** The report's definition fields: name, description, main-db picker, output
 *  types and the SQL editor. `dbs` are the databases in this report's store. */
export function ReportEditorFields({ draft, dbs, patch, toggleType }: ReportEditorFieldsProps) {
  return (
    <>
      <ReportMetaFields draft={draft} patch={patch} />

      <Select
        label="Main db"
        labelPosition="left"
        labelWidth={70}
        tooltip="The database opened directly. Pick None to run purely off ATTACH'd files (an in-memory scratch db is used)."
        value={draft.db}
        searchable
        placeholder="(None — attach only)"
        options={[
          { value: '', label: '(None — attach only)' },
          ...dbs.map((d) => ({ value: d.path, label: d.fileName, hint: d.store })),
        ]}
        onChange={(v) => patch({ db: v ?? '' })}
      />

      <ReportTypeToggles draft={draft} toggleType={toggleType} />

      <ReportSqlInfo />
      <SqlCodeEditor resizable className="h-32 min-h-16" value={draft.sql} onChange={(v) => patch({ sql: v })} />
    </>
  );
}
