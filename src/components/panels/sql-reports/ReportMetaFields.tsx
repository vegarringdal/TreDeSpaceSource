import { TextArea, TextInput } from '@treDeSpaceUI/widgets';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';

type ReportMetaFieldsProps = Readonly<{
  draft: ReportDef;
  patch: (p: Partial<ReportDef>) => void;
}>;

/** Name + description of a report draft — shared by the report editor and
 *  the SQL Editor. */
export function ReportMetaFields({ draft, patch }: ReportMetaFieldsProps) {
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
    </>
  );
}
