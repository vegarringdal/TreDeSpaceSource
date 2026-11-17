import { PromptDialogCore } from '@treDeSpaceUI/widgets';
import { dialogs } from './dialogs.actions';
import { dialogsState } from './dialogs.state';

export function PromptDialog() {
  const { prompt } = dialogsState.use();
  if (!prompt) {
    return null;
  }

  // keyed by the ask, so the next queued prompt remounts and takes focus
  const { seq, ...props } = prompt;
  return <PromptDialogCore key={seq} {...props} onChange={dialogs.setPromptValue} onResult={dialogs.resolvePrompt} />;
}
