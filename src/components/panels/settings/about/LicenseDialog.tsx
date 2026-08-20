import { IconLicense, IconX } from '@tabler/icons-react';
import { Button, Modal, TitleBar } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import licenseText from '../../../../../LICENSE?raw';

/** One display block parsed from the plain-text LICENSE. */
type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

/** Blank-line-separated blocks; ALL-CAPS single lines become headings and
 *  "- " lines become lists, so the file stays a plain .txt for lawyers/tools
 *  and still reads nicely here. */
function parseLicense(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }
    if (lines.every((l) => l.startsWith('- '))) {
      blocks.push({ kind: 'list', items: lines.map((l) => l.slice(2)) });
    } else if (lines.length === 1 && /^[A-Z0-9 ./()&—-]+$/.test(lines[0])) {
      blocks.push({ kind: 'heading', text: lines[0] });
    } else {
      // a trailing "Authorized parties…:" style intro followed by "- x" items
      const listStart = lines.findIndex((l) => l.startsWith('- '));
      if (listStart > 0) {
        blocks.push({ kind: 'paragraph', text: lines.slice(0, listStart).join(' ') });
        blocks.push({ kind: 'list', items: lines.slice(listStart).map((l) => l.slice(2)) });
      } else {
        blocks.push({ kind: 'paragraph', text: lines.join(' ') });
      }
    }
  }
  return blocks;
}

const BLOCKS = parseLicense(licenseText);

/** Button in Settings → About that shows the app's LICENSE, formatted. */
export function LicenseDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<IconLicense size={14} />} onClick={() => setOpen(true)} tooltip="The TreDeSpace license terms">
        Show license
      </Button>

      {open && (
        <Modal z={2000} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <div className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl">
            <TitleBar icon={<IconLicense size={16} className="shrink-0 text-blue-400" />}>
              <span>License</span>
              <button
                type="button"
                className="ml-auto cursor-pointer text-slate-400 hover:text-slate-200"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <IconX size={15} />
              </button>
            </TitleBar>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
              {BLOCKS.map((b, i) => {
                const key = `${b.kind}-${i}`;
                if (b.kind === 'heading') {
                  return (
                    <div key={key} className="mt-1 font-semibold text-slate-200 text-xs tracking-wide">
                      {b.text}
                    </div>
                  );
                }
                if (b.kind === 'list') {
                  return (
                    <ul key={key} className="list-disc pl-5 text-slate-400 text-xs leading-relaxed">
                      {b.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={key} className={`text-xs leading-relaxed ${i === 0 ? 'text-slate-200' : 'text-slate-400'}`}>
                    {b.text}
                  </p>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
