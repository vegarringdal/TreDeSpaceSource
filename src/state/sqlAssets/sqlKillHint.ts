// The "press X to cancel" hint appended to SQL loading dialogs — X is the live
// combo bound to sql.kill (which terminates the shared worker, cancelling
// whatever query is running).
import { formatSequence, hotkeysActions } from '@treDeSpaceUI/hotkeys';

export function killHint(): string {
  const seq = hotkeysActions.sequenceFor('sql.kill');
  // on its own line — the loading dialog renders newlines (whitespace-pre-line)
  return seq ? `\n${formatSequence(seq)} to cancel` : '';
}
