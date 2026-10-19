import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { CameraKey, LabelsKey, MeasurementsKey, ObjectKey, RulesKey, SectionKey } from '../../lib/animation/types';

/** Copied keys of one row, the first at 0 — pasted at the time slider into
 *  a row of the same kind (object keys into any object). */
export type KeyClip =
  | { kind: 'object'; keys: ObjectKey[] }
  | { kind: '@camera'; keys: CameraKey[] }
  | { kind: '@section'; keys: SectionKey[] }
  | { kind: '@rules'; keys: RulesKey[] }
  | { kind: '@labels'; keys: LabelsKey[] }
  | { kind: '@measurements'; keys: MeasurementsKey[] };

/** The key clipboard (DESIGN.md › Animation › Authoring) — session only;
 *  mutations in keys.actions.ts. */
export interface KeyClipboardState {
  clip: KeyClip | null;
}

export const keyClipboardState = createStore<KeyClipboardState>({ clip: null });
