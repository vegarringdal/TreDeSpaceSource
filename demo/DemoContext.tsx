import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TredespaceClient } from '../api/tredespace-client';
import { APP_ORIGIN, CONFIG_PARAM, IS_DIALOG } from './hostEnv';
import { makeRun, type RunFn } from './runCommand';
import { useDemoEvents } from './useDemoEvents';
import { type LogCls, type LogLine, useDemoLog } from './useDemoLog';

export type StoreInfo = Readonly<{ name: string; count: number }>;

type DemoContextValue = Readonly<{
  lines: readonly LogLine[];
  line: (cls: LogCls, text: string) => void;
  clearLog: () => void;
  /** Run a command, logging request + full response (or error). */
  run: RunFn;
  /** Active client — throws (caught + logged by run) until the viewer exists. */
  c: () => TredespaceClient;
  listening: boolean;
  listenEvents: () => void;
  stopEvents: () => void;
  /** Shared store registry (models + SQL) — filled by any stores.list/create. */
  stores: readonly StoreInfo[];
  setStores: (stores: readonly StoreInfo[]) => void;
  /** Iframe-mode ref callback: creates the client once the iframe mounts. */
  attachIframe: (el: HTMLIFrameElement | null) => void;
}>;

const DemoContext = createContext<DemoContextValue | null>(null);

/** Demo-wide state: the console log, the SDK client, event subs and stores. */
export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    throw new Error('useDemo must be used inside DemoProvider');
  }

  return ctx;
}

export function DemoProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { lines, line, clearLog } = useDemoLog();
  const clientRef = useRef<TredespaceClient | null>(null);
  const [stores, setStores] = useState<readonly StoreInfo[]>([]);

  const c = useCallback((): TredespaceClient => {
    if (!clientRef.current) {
      throw new Error('no viewer connection — dialog mode must run inside the viewer (External app panel)');
    }

    return clientRef.current;
  }, []);

  const { listening, subscribe, listenEvents, stopEvents } = useDemoEvents(line, c);

  const run = useMemo(() => makeRun(line), [line]);

  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el == null || clientRef.current != null) {
        return;
      }

      const cl = new TredespaceClient(el, { targetOrigin: APP_ORIGIN });
      clientRef.current = cl;
      void cl.ready().then((r) => line('ok', `app.ready — version ${r.version}, api v${r.api}`));
      subscribe(cl);
    },
    [line, subscribe],
  );

  // dialog mode: this page IS inside the viewer — the viewer is window.parent,
  // nothing to embed. The app announced app.ready before this panel existed,
  // so ping with settings.get instead.
  useEffect(() => {
    if (CONFIG_PARAM != null) {
      line('out', `host config (?config=): ${CONFIG_PARAM}`);
    }

    if (!IS_DIALOG) {
      return;
    }

    if (window.parent === window) {
      line(
        'err',
        'dialog mode expects to run INSIDE the viewer — add this URL as an External app (Settings → External)',
      );
      return;
    }

    const parentOrigin = document.referrer ? new URL(document.referrer).origin : location.origin;
    const cl = new TredespaceClient(window.parent, { targetOrigin: parentOrigin });
    clientRef.current = cl;
    subscribe(cl);
    void cl
      .settingsGet()
      .then((r) =>
        r.error
          ? line('err', `host viewer ping failed: ${r.error.msg}`)
          : line('ok', `connected to host viewer — version ${r.data?.version}`),
      )
      .catch((e) => line('err', `host viewer not responding: ${(e as Error).message}`));
  }, [line, subscribe]);

  return (
    <DemoContext.Provider
      value={{ lines, line, clearLog, run, c, listening, listenEvents, stopEvents, stores, setStores, attachIframe }}
    >
      {children}
    </DemoContext.Provider>
  );
}
