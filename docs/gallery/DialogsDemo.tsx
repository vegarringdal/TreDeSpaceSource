import { IconBox } from '@tabler/icons-react';
import {
  Button,
  ConfirmDialogCore,
  ErrorDialogCore,
  LoadingDialogCore,
  Modal,
  PromptDialogCore,
  TitleBar,
} from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for the dialog cores (Confirm / Prompt / Error / Loading)
 *  and the Modal + TitleBar shell they all render through. */
export function DialogsDemo() {
  const [confirm, setConfirm] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);
  const [promptValue, setPromptValue] = useState('Viewpoint 1');
  const [last, setLast] = useState('');
  return (
    <Section
      title="Dialogs"
      note="The dialog cores are pure: props in, onResult out, no store coupling — the app wraps them in its own dialogs helper. All render through the shared Modal shell (dimmed backdrop + centred window, portaled to the body) with a TitleBar — both exported, so a host can build its own dialogs in the same look (the Custom button shows the bare shell)."
      props={[
        'ConfirmDialogCoreProps',
        'PromptDialogCoreProps',
        'ErrorDialogCoreProps',
        'LoadingDialogCoreProps',
        'ModalProps',
        'TitleBarProps',
      ]}
      code={`function ResetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Reset…</Button>
      {open && (
        <ConfirmDialogCore title="Reset scene" okLabel="Reset"
          cancelLabel="Cancel" message="Reset the scene to defaults?"
          onResult={(ok) => { setOpen(false); if (ok) reset(); }} />
      )}
    </>
  );
}`}
    >
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => setConfirm(true)}>Confirm</Button>
        <Button onClick={() => setPrompt(true)}>Prompt</Button>
        <Button onClick={() => setError(true)}>Error</Button>
        <Button
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1800);
          }}
        >
          Loading (1.8 s)
        </Button>
        <Button onClick={() => setCustom(true)}>Custom (Modal + TitleBar)</Button>
      </div>
      {last && <p className="m-0 mt-2 text-slate-500 text-xs">Last result: {last}</p>}
      {confirm && (
        <ConfirmDialogCore
          title="Reset scene"
          message="Reset the scene to defaults?"
          okLabel="Reset"
          cancelLabel="Cancel"
          onResult={(ok) => {
            setConfirm(false);
            setLast(`confirm → ${ok}`);
          }}
        />
      )}
      {prompt && (
        <PromptDialogCore
          title="Rename viewpoint"
          message="New name:"
          value={promptValue}
          okLabel="Rename"
          onChange={setPromptValue}
          onResult={(ok) => {
            setPrompt(false);
            setLast(ok ? `prompt → "${promptValue}"` : 'prompt → cancelled');
          }}
        />
      )}
      {error && (
        <ErrorDialogCore
          title="Demo error"
          message="The knot refused to untangle itself."
          onDismiss={() => {
            setError(false);
            setLast('error dismissed');
          }}
        />
      )}
      {loading && <LoadingDialogCore title="Working" label="Pretending to work…" />}
      {custom && (
        <Modal z={100}>
          <div className="w-[320px] border border-slate-700 bg-slate-900 shadow-xl">
            <TitleBar icon={<IconBox size={14} />}>Custom dialog</TitleBar>
            <div className="p-3 text-slate-300">
              Any content, framed by the shared shell: dimmed backdrop, centred window, TitleBar on top.
            </div>
            <div className="flex justify-end p-3 pt-0">
              <Button onClick={() => setCustom(false)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}
