import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

interface DialogControlsProps {
  /** The dialog the buttons address — filled in by externalApps.set (the
   *  modal it opened) or typed; the tdsDialogId a page sees on its URL works too. */
  dialogId: string;
  onDialogIdChange: (id: string) => void;
}

/** The `ui.dialog.*` family in the demo: list, hide / show / close, rename —
 *  each addressing a dialog by its dialog id or the page's own tdsDialogId. */
export function DialogControls({ dialogId, onDialogIdChange }: DialogControlsProps) {
  const { run, c, line } = useDemo();
  const [title, setTitle] = useState('Detail report');

  const requireId = (): string => {
    const id = dialogId.trim();
    if (!id) {
      line('err', 'no dialog id yet — run externalApps.set (or ui.dialogs) first');
    }
    return id;
  };

  const handleDialog = (action: 'hide' | 'show' | 'close', remove = false) => {
    const id = requireId();
    if (!id) {
      return;
    }

    const call = () => {
      if (action === 'close') {
        return c().uiDialogClose(id, remove ? { remove } : undefined);
      }
      return action === 'hide' ? c().uiDialogHide(id) : c().uiDialogShow(id);
    };
    void run(`ui.dialog.${action}`, remove ? { id, remove } : { id }, call);
  };

  const handleRename = () => {
    const id = requireId();
    if (!id) {
      return;
    }

    void run('ui.dialog.rename', { id, title }, () => c().uiDialogRename(title, id));
  };

  return (
    <>
      <Hint>
        Dialog control by id (the dialog id, or the tdsDialogId the page sees on its URL) — hide keeps the iframe
        MOUNTED, so the page inside keeps its state and show brings it back untouched (close drops it). Park a dialog
        while a model loads, then show or close it. Rename retitles the dialog — a report list naming itself after the
        report the user opened. Every change arrives as a dialog.changed event (watch the console while listening).
      </Hint>
      <Row>
        <TextInput value={dialogId} onChange={onDialogIdChange} placeholder="dialog id" className="min-w-0 flex-1" />
        <Button onClick={() => void run('ui.dialogs', {}, () => c().uiDialogs())}>ui.dialogs</Button>
      </Row>
      <Row>
        <Button onClick={() => handleDialog('hide')}>ui.dialog.hide</Button>
        <Button onClick={() => handleDialog('show')}>ui.dialog.show</Button>
        <Button onClick={() => handleDialog('close')}>ui.dialog.close</Button>
        <Button
          tooltip="Close AND forget the instance: definition, dock location, tdsDialogId"
          onClick={() => handleDialog('close', true)}
        >
          ui.dialog.close (remove)
        </Button>
      </Row>
      <Row>
        <TextInput value={title} onChange={setTitle} placeholder="new title" className="min-w-0 flex-1" />
        <Button onClick={handleRename}>ui.dialog.rename</Button>
      </Row>
    </>
  );
}
