import { ConfirmDialog } from './ConfirmDialog';
import { ErrorDialog } from './ErrorDialog';
import { LoadingDialog } from './LoadingDialog';
import { PromptDialog } from './PromptDialog';

export { type ConfirmOptions, dialogs } from './dialogs.actions';
export { type DialogsState, dialogsState } from './dialogs.state';
export { ConfirmDialog, ErrorDialog, LoadingDialog, PromptDialog };

/** Mount once, anywhere (App): all three dialog layers. */
export function DialogHost() {
  return (
    <>
      <ConfirmDialog />
      <PromptDialog />
      <ErrorDialog />
      <LoadingDialog />
    </>
  );
}
