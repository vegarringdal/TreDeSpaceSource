import { useCallback, useRef, useState } from 'react';
import type { TredespaceClient } from '../api/tredespace-client';
import { IS_DIALOG } from './hostEnv';
import type { LogCls } from './useDemoLog';

/** Event subscription (Events section): ON by default (subscribe is called on
 *  connect), toggleable to demo the unsubscribe functions returned by the on*
 *  helpers. Every received event is pretty-printed to the console. */
export function useDemoEvents(
  line: (cls: LogCls, text: string) => void,
  c: () => TredespaceClient,
): {
  listening: boolean;
  subscribe: (cl: TredespaceClient) => void;
  listenEvents: () => void;
  stopEvents: () => void;
} {
  const unsubRef = useRef<(() => void) | null>(null);
  const [listening, setListening] = useState(false);

  const subscribe = useCallback(
    (cl: TredespaceClient) => {
      unsubRef.current?.();
      const offs = [
        // hosted inside the viewer: a last word before this page is unmounted —
        // the host sees it as instance.changed (this page itself is gone by then)
        ...(IS_DIALOG
          ? [cl.onDialogClosing(() => cl.instanceSet({ demoClosedAt: new Date().toISOString() }, { merge: true }))]
          : []),
        cl.onTreeSelect((e) => line('out', `⚡ tree.select ${JSON.stringify(e, null, 2)}`)),
        cl.onInstanceChanged((e) => line('out', `⚡ instance.changed ${JSON.stringify(e.data)}`)),
        cl.onThemeChanged((e) => line('out', `⚡ theme.changed ${e.theme}`)),
        cl.onDialogChanged((e) => line('out', `⚡ dialog.changed ${e.state} ${e.id} "${e.name}"`)),
        cl.onViewpointsBookmark((e) =>
          line('out', `⚡ viewpoints.bookmark "${e.label}" — ${e.config.viewpoints.length} viewpoint(s) attached`),
        ),
      ];
      unsubRef.current = () => {
        for (const off of offs) {
          off();
        }
      };
      setListening(true);
      line(
        'ok',
        '← listening for tree.select + instance.changed + theme.changed + viewpoints.bookmark + dialog.changed',
      );
    },
    [line],
  );

  const listenEvents = useCallback(() => {
    line('', '→ listen events');
    try {
      if (unsubRef.current) {
        line('ok', '← already listening');
        return;
      }

      subscribe(c());
    } catch (e) {
      line('err', `← ${(e as Error).message}`);
    }
  }, [line, subscribe, c]);

  const stopEvents = useCallback(() => {
    line('', '→ stop listening');
    if (!unsubRef.current) {
      line('ok', '← was not listening');
      return;
    }

    unsubRef.current();
    unsubRef.current = null;
    setListening(false);
    line('ok', '← unsubscribed from every event');
  }, [line]);

  return { listening, subscribe, listenEvents, stopEvents };
}
