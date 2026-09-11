import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TredespaceClient } from '../api/tredespace-client';
import { APP_ORIGIN, APP_URL, CONFIG_PARAM, IS_DIALOG, IS_POPUP } from './hostEnv';
import { makeRun, type RunFn } from './runCommand';
import { useDemoEvents } from './useDemoEvents';
import { type LogCls, type LogLine, useDemoLog } from './useDemoLog';

export type StoreInfo = Readonly<{ name: string; count: number; modelCount: number; sqlCount: number }>;

/** The viewer link as app.ready / app.bye report it. */
export type Connection = 'waiting' | 'connected' | 'gone';

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
  connection: Connection;
  /** Iframe mode: reload the embedded viewer — fires app.bye, then app.ready. */
  reloadViewer: () => void;
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [stores, setStores] = useState<readonly StoreInfo[]>([]);
  const [connection, setConnection] = useState<Connection>('waiting');

  const c = useCallback((): TredespaceClient => {
    if (!clientRef.current) {
      throw new Error('no viewer connection — dialog mode runs inside the viewer, popup mode is opened by a demo page');
    }

    return clientRef.current;
  }, []);

  const { listening, subscribe, listenEvents, stopEvents } = useDemoEvents(line, c);

  const run = useMemo(() => makeRun(line), [line]);

  // every app.ready (first boot and each return after an app.bye) and every
  // app.bye drive the badge in the header — not part of the toggleable
  // Events subscription, so "stop listening" cannot freeze it
  const watchConnection = useCallback(
    (cl: TredespaceClient) => {
      cl.onAppReady((r) => {
        setConnection('connected');
        line('ok', `⚡ app.ready — version ${r.version}, api v${r.api}`);
      });
      cl.onAppBye((e) => {
        setConnection('gone');
        line('err', `⚡ app.bye (${e.reason}) — viewer going away: in-flight requests failed, ready() re-armed`);
      });
    },
    [line],
  );

  const reloadViewer = useCallback(() => {
    const el = iframeRef.current;
    if (!el) {
      line('err', 'no viewer iframe to reload here — this page is hosted by the viewer');
      return;
    }

    line('', '→ reload the viewer iframe (expect app.bye, then app.ready)');
    el.src = APP_URL;
  }, [line]);

  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el == null || clientRef.current != null) {
        return;
      }

      iframeRef.current = el;
      const cl = new TredespaceClient(el, { targetOrigin: APP_ORIGIN });
      clientRef.current = cl;
      watchConnection(cl);
      subscribe(cl);
    },
    [watchConnection, subscribe],
  );

  // popup mode: this window was OPENED by another page — a demo page relaying
  // for it, or the viewer itself (an External app in tab mode). Either way the
  // client drives window.opener exactly like it would drive the viewer, and
  // the opener answers ready() with app.ready
  useEffect(() => {
    if (!IS_POPUP) {
      return;
    }

    const opener: Window | null = window.opener;
    if (!opener) {
      line(
        'err',
        'popup mode expects to be OPENED — by a demo page ("open relayed window") or by the viewer (tab-mode app)',
      );
      return;
    }

    const openerOrigin = document.referrer ? new URL(document.referrer).origin : location.origin;
    const cl = new TredespaceClient(opener, { targetOrigin: openerOrigin });
    clientRef.current = cl;
    watchConnection(cl);
    subscribe(cl);
  }, [line, watchConnection, subscribe]);

  // dialog mode: this page IS inside the viewer — the viewer is window.parent,
  // nothing to embed. The app announced app.ready before this panel existed;
  // it answers the client's hello with it, so ready() still resolves.
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
    watchConnection(cl);
    subscribe(cl);
  }, [line, watchConnection, subscribe]);

  return (
    <DemoContext.Provider
      value={{
        lines,
        line,
        clearLog,
        run,
        c,
        listening,
        listenEvents,
        stopEvents,
        stores,
        setStores,
        attachIframe,
        connection,
        reloadViewer,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
