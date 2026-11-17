import { ConfirmDialogCore } from '@treDeSpaceUI/widgets';
import { dialogs } from './dialogs.actions';
import { dialogsState } from './dialogs.state';

export function ConfirmDialog() {
  const { confirm } = dialogsState.use();
  if (!confirm) {
    return null;
  }
  return <ConfirmDialogCore {...confirm} onResult={dialogs.resolveConfirm} />;
}
