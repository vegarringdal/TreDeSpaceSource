import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import type { AnimationBookmarkEvent } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

type AnimationBookmarkPanelProps = Readonly<{
  /** present a doc (the bookmark's) the way the section's button does */
  onPresent: (doc: Record<string, unknown>, label: string) => void;
}>;

/** The Animation ribbon's Bookmark button: show / remove it, keep the last
 *  bookmark the user sent, and present it again. */
export function AnimationBookmarkPanel({ onPresent }: AnimationBookmarkPanelProps) {
  const { run, c, line, connection } = useDemo();
  const [label, setLabel] = useState('Bookmark');
  const [last, setLast] = useState<AnimationBookmarkEvent | null>(null);

  useEffect(() => {
    if (connection !== 'connected') {
      return;
    }
    const ac = new AbortController();
    try {
      c().onAnimationBookmark(setLast, { signal: ac.signal });
    } catch {
      // no client yet — the next connection subscribes
    }
    return () => ac.abort();
  }, [connection, c]);

  const handleShow = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      line('err', 'enter a button label');
      return;
    }
    void run('animation.setBookmarkButton', { button: { label: trimmed } }, () =>
      c().animationSetBookmarkButton({ label: trimmed, tooltip: 'Send this animation to the demo host' }),
    );
  };

  return (
    <>
      <Hint>Bookmark button (a section of its own at the end of the Animation ribbon):</Hint>
      <Row>
        <TextInput value={label} onChange={setLabel} placeholder="button label" className="min-w-0 flex-1" />
        <Button onClick={handleShow}>show button</Button>
        <Button
          onClick={() =>
            void run('animation.setBookmarkButton', { button: null }, () => c().animationSetBookmarkButton(null))
          }
        >
          remove
        </Button>
      </Row>
      <Row>
        <Button
          disabled={!last}
          tooltip="animation.present with the doc the last animation.bookmark event carried"
          onClick={() => last && onPresent(last.doc, `(bookmark "${last.label}")`)}
        >
          present last bookmark
        </Button>
        <Hint>{last ? `"${last.label}" — ${String(last.doc.name ?? 'animation')}` : 'no bookmark received yet'}</Hint>
      </Row>
    </>
  );
}
