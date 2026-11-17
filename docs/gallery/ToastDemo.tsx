import { Button, Toaster, toast } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for the toast stack. */
export function ToastDemo() {
  return (
    <Section
      title="Toast"
      note="Non-blocking notifications — the alternative to stopping the user with a confirm() they can only acknowledge. `toast.*` is callable from anywhere, React or not; render <Toaster /> once at the app root. They stack bottom-right above the modal layer, hold while the pointer is over them, and errors stay until dismissed."
      props={['ToastOptions', 'ToasterProps', 'ToastItem']}
      code={`// once, at the app root
<Toaster />

// anywhere — a worker callback, an action, a hotkey
toast.success(\`Loaded \${n} label(s).\`);
toast.warning('Import failed: bad JSON');
toast.error('GPU device lost', { title: 'Renderer' });`}
    >
      <Toaster />
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => toast.info('Camera reset to the scene bounds.')}>Info</Button>
        <Button onClick={() => toast.success('Loaded 42 label(s).')}>Success</Button>
        <Button onClick={() => toast.warning('Import failed: 3 tags not found.')}>Warning</Button>
        <Button onClick={() => toast.error('GPU device lost.', { title: 'Renderer' })}>Error (stays)</Button>
        <Button onClick={() => toast.clear()}>Clear all</Button>
      </div>
    </Section>
  );
}
