import type { SelectOption } from '@treDeSpaceUI/widgets';
import type { ImportFormat, Result } from '../api/tredespace-client';

/** Unwrap a Result to its data, or throw the pretty error (caught + logged by run). */
export function must<T>(res: Result<T>): T {
  if (res.error || res.data === undefined) {
    throw new Error(res.error ? `${res.error.code}: ${res.error.msg}` : 'no data');
  }

  return res.data;
}

/** Narrow to a plain JSON object (not null, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Textarea value → trimmed, non-empty lines. */
export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const IMPORT_FORMATS: readonly ImportFormat[] = ['glb-standard', 'glb-merged', 'rvm', 'ifc', 'step', 'tdp'];

export const IMPORT_FORMAT_OPTIONS: SelectOption[] = IMPORT_FORMATS.map((f) => ({ value: f, label: f }));

/** Narrow a Select value back to an ImportFormat without an `as` cast. */
export function toImportFormat(value: string | null): ImportFormat | undefined {
  return IMPORT_FORMATS.find((f) => f === value);
}
