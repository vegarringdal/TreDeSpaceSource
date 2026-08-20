import { ErrorDialogCore } from '@treDeSpaceUI/widgets';
import { dialogs } from './dialogs.actions';
import { dialogsState } from './dialogs.state';

export function ErrorDialog() {
  const { error } = dialogsState.use();
  if (!error) {
    return null;
  }
  return <ErrorDialogCore {...error} onDismiss={dialogs.dismissError} />;
}
