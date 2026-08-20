import { LoadingDialogCore } from '@treDeSpaceUI/widgets';
import { dialogsState } from './dialogs.state';

export function LoadingDialog() {
  const { loading } = dialogsState.use();
  if (!loading) {
    return null;
  }
  return <LoadingDialogCore {...loading} />;
}
