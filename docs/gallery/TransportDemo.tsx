import { IconDownload } from '@tabler/icons-react';
import { SplitButton, TransportControls, type TransportStatus } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for TransportControls + SplitButton. */
export function TransportDemo() {
  const [status, setStatus] = useState<TransportStatus>('stopped');
  const [last, setLast] = useState('');
  const toggle = () => setStatus((s) => (s === 'playing' ? 'paused' : 'playing'));
  const menu = [
    { id: 'return', label: 'Continue — return to the animation view', onSelect: () => setLast('return') },
    { id: 'keep', label: 'Continue — keep my view', onSelect: () => setLast('keep') },
  ];
  return (
    <Section
      title="TransportControls / SplitButton"
      note="Media transport: previous · play/pause/continue · next · stop. The main button's label follows `status` (Play / Pause / Continue); prev, next and stop appear only when their callback is passed, and Stop is disabled while stopped. `playMenu` turns the main button into a SplitButton for 'continue how?' choices. `size='lg'` gives 40 px touch targets. SplitButton on its own is a default action plus a chevron menu of alternatives, the two halves sharing an edge: `menuTooltip` names the chevron, `active` gives the main part the 'on' look, `grow` fills a flex row."
      props={['TransportControlsProps', 'TransportStatus', 'SplitButtonProps']}
      code={`function Player() {
  const [status, setStatus] = useState<TransportStatus>('stopped');
  return (
    <>
      <TransportControls
        status={status}
        onPlayPause={() => setStatus((s) => (s === 'playing' ? 'paused' : 'playing'))}
        onStop={() => setStatus('stopped')}   // omit = no button; disabled while stopped
        onPrev={prevPart}
        onNext={nextPart}
        playMenu={status === 'paused' ? [{ id: 'keep', label: 'Keep my view', onSelect: keepView }] : undefined}
        shortcuts={{ playPause: 'player.playPause' }}
      />
      <SplitButton
        icon={<IconDownload />}
        label="Export"
        tooltip="Export the view as a PDF"
        menuTooltip="Other formats"
        onClick={exportPdf}
        menu={[{ id: 'png', label: 'As PNG', onSelect: exportPng }]}
      />
    </>
  );
}`}
    >
      <div className="flex flex-col gap-3">
        <TransportControls
          status={status}
          onPlayPause={toggle}
          onStop={() => setStatus('stopped')}
          onPrev={() => setLast('prev')}
          onNext={() => setLast('next')}
          playMenu={status === 'paused' ? menu : undefined}
        />
        <TransportControls
          size="lg"
          status={status}
          onPlayPause={toggle}
          onPrev={() => setLast('prev')}
          onNext={() => setLast('next')}
        />
        <SplitButton
          icon={<IconDownload />}
          label="Export"
          tooltip="Export the view as a PDF"
          menuTooltip="Other formats"
          onClick={() => setLast('export')}
          menu={[{ id: 'png', label: 'As PNG', onSelect: () => setLast('png') }]}
        />
        <span className="text-slate-400">
          status: {status}
          {last && ` · last: ${last}`}
        </span>
      </div>
    </Section>
  );
}
