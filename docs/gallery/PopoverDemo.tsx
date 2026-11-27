import { Button, PickerPopover, usePopoverAnchor } from '@treDeSpaceUI/widgets';
import { type KeyboardEvent, useState } from 'react';
import { Section } from './Section';

const POP_WIDTH = 260;
const POP_HEIGHT = 190;

/** The lines of a one-value-per-line list, blanks skipped. */
const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);

/** Gallery section for usePopoverAnchor + PickerPopover. */
export function PopoverDemo() {
  const anchor = usePopoverAnchor(POP_HEIGHT);
  const [text, setText] = useState('PIPE\nVALVE');
  const values = linesOf(text);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      anchor.setOpen(false);
    }
  };

  return (
    <Section
      title="Anchored popover"
      note="usePopoverAnchor + PickerPopover: the pieces the pickers are built from, for a popover of your own under a field or button. The hook holds the open state, closes on a press outside the trigger and the popover, follows the trigger while anything scrolls, and flips upward when the estimated height does not fit below. PickerPopover is the body-portaled box, so a panel's scroll never clips it. Escape is yours to handle."
      props={['PickerPopoverProps']}
      code={`function ListField() {
  const anchor = usePopoverAnchor(190);   // estimated height in px
  const [text, setText] = useState('');
  return (
    <div ref={anchor.rootRef}>
      <Button onClick={() => anchor.setOpen((o) => !o)}>Edit list</Button>
      {anchor.open && (
        <PickerPopover anchor={anchor} width={260}>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && anchor.setOpen(false)}
          />
        </PickerPopover>
      )}
    </div>
  );
}`}
    >
      <div ref={anchor.rootRef} className="flex items-center gap-2">
        <Button active={anchor.open} onClick={() => anchor.setOpen((o) => !o)}>
          Edit list
        </Button>
        <span className="text-slate-400">
          {values.length} value{values.length === 1 ? '' : 's'}: {values.join('; ') || '—'}
        </span>
      </div>
      {anchor.open && (
        <PickerPopover anchor={anchor} width={POP_WIDTH}>
          <div className="grid gap-1.5 p-1.5">
            <span className="text-slate-400">One value per line</span>
            <textarea
              // biome-ignore lint/a11y/noAutofocus: the popover opened to edit this list
              autoFocus
              value={text}
              spellCheck={false}
              className="h-32 w-full resize-y border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[11px] text-slate-200 outline-none focus:border-blue-400"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => anchor.setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PickerPopover>
      )}
    </Section>
  );
}
