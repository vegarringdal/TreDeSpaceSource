import { PromptDialogCore } from '@treDeSpaceUI/widgets';
import { dialogs } from './dialogs.actions';
import { dialogsState } from './dialogs.state';

export function PromptDialog() {
  const { prompt } = dialogsState.use();
  if (!prompt) {
    return null;
  }
  return <PromptDialogCore {...prompt} onChange={dialogs.setPromptValue} onResult={dialogs.resolvePrompt} />;
}
