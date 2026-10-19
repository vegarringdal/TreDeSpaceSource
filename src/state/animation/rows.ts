// Timeline row ids (DESIGN.md › Animation › Authoring): the scene rows
// have fixed ids, each object row is `o:<object id>`. The current row is
// what Key keys; key selections name their row.

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** A scene row: the Scene itself (its settings), Steps, Camera, Clipping
 *  (`@section`), Colour rules, Labels, Measurements, Overlays (`@callouts`)
 *  and the Objects group the object rows sit under. */
export type SceneRow =
  | '@scene'
  | '@steps'
  | '@camera'
  | '@section'
  | '@rules'
  | '@labels'
  | '@measurements'
  | '@callouts'
  | '@objects';

/** A Timeline row: a scene row or an object row. */
export type RowId = SceneRow | `o:${string}`;

/** The rows whose keys are plain timed keys (not spans). */
export type KeyRow = '@camera' | '@section' | '@rules' | '@labels' | '@measurements' | `o:${string}`;

/** Rows whose keys are sets shown from their time on (no interpolation). */
export type SetRow = '@rules' | '@labels' | '@measurements';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

export const SCENE_ROWS: readonly { row: SceneRow; label: string }[] = [
  { row: '@scene', label: 'Scene' },
  { row: '@steps', label: 'Steps' },
  { row: '@camera', label: 'Camera' },
  { row: '@section', label: 'Clipping' },
  { row: '@rules', label: 'Colour rules' },
  { row: '@labels', label: 'Labels' },
  { row: '@measurements', label: 'Measurements' },
  { row: '@callouts', label: 'Overlays' },
  { row: '@objects', label: 'Objects' },
];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

export function objectRow(id: string): `o:${string}` {
  return `o:${id}`;
}

/** The object id of an object row, else null. */
export function rowObject(row: RowId | null | undefined): string | null {
  return row?.startsWith('o:') ? row.slice(2) : null;
}

/** A row id from a string (Timeline callbacks), else null. */
export function asRowId(s: string): RowId | null {
  if (s.startsWith('o:') && s.length > 2) {
    return objectRow(s.slice(2));
  }
  return SCENE_ROWS.find((r) => r.row === s)?.row ?? null;
}

/** Rows holding timed keys (Key, key selections, copy / paste). */
export function isKeyRow(row: RowId): row is KeyRow {
  return (
    row === '@camera' ||
    row === '@section' ||
    row === '@rules' ||
    row === '@labels' ||
    row === '@measurements' ||
    row.startsWith('o:')
  );
}

/** Rows whose keys switch at their time (no interpolation, no Arrives). */
export function isSetRow(row: RowId | null | undefined): row is SetRow {
  return row === '@rules' || row === '@labels' || row === '@measurements';
}
