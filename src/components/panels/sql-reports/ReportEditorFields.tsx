import { InfoButton, Select, SqlCodeEditor, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import type { SqlDbEntry } from '../../../state/sqlAssets/sqlAssets.state';
import type { ReportDef, ReportType } from '../../../state/sqlReports/sqlReports.state';

const TYPES: ReportType[] = ['TABLE', 'COLORING', 'DETAIL'];

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
      <TextInput
        label="Name"
        labelPosition="left"
        labelWidth={70}
        value={draft.name}
        onChange={(v) => patch({ name: v })}
      />
      <TextArea
        label="Description"
        labelPosition="left"
        labelWidth={70}
        minHeight={48}
        placeholder="Shown above the report's filters — **bold** and newlines supported"
        value={draft.description}
        onChange={(v) => patch({ description: v })}
      />

      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-[70px] shrink-0">Main db</span>
        <div
          className="min-w-0 flex-1"
          data-tooltip="The database opened directly. Pick None to run purely off ATTACH'd files (an in-memory scratch db is used)."
        >
          <Select
            value={draft.db}
            searchable
            placeholder="(None — attach only)"
            options={[
              { value: '', label: '(None — attach only)' },
              ...dbs.map((d) => ({ value: d.path, label: d.fileName, hint: d.store })),
            ]}
            onChange={(v) => patch({ db: v ?? '' })}
          />
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-3 text-slate-300 text-xs">
        <span className="w-[70px] shrink-0 text-slate-400">Types</span>
        {TYPES.map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-1.5" data-tooltip={`Enable the ${t} output`}>
            <input type="checkbox" checked={draft.types.includes(t)} onChange={() => toggleType(t)} />
            {t}
          </label>
        ))}
      </div>

      <span className="flex items-center gap-1.5 text-slate-400 text-xs">
        SQL — drag the bottom-right corner to resize
        <InfoButton label="How report SQL runs">
          The last SQL statement is the report query; earlier statements run as setup. Use{' '}
          <code>SELECT v FROM FILTER_ARGS WHERE k='key'</code> for a filter, and (Detail){' '}
          <code>SELECT FULLNAME FROM TREE_VIEW_ARGS</code> for the clicked hierarchy.
        </InfoButton>
      </span>
      <SqlCodeEditor resizable className="h-32 min-h-16" value={draft.sql} onChange={(v) => patch({ sql: v })} />
    </>
  );
}
