import { ControlsColumn } from './components/ControlsColumn';
import { LogConsole } from './components/LogConsole';
import { DemoProvider, useDemo } from './DemoContext';
import { APP_URL, IS_DIALOG } from './hostEnv';

function DemoShell() {
  const { attachIframe } = useDemo();

  // dialog mode (?dialog=1): this page is EMBEDDED IN the viewer (External app
  // panel) and drives window.parent — no iframe of its own; actions fill the
  // page, console docked at the bottom
  if (IS_DIALOG) {
    return (
      <div className="flex h-screen flex-col bg-slate-900 font-sans text-slate-200 text-xs">
        <ControlsColumn />
        <LogConsole className="h-[260px] border-slate-800 border-t" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-900 font-sans text-slate-200 text-xs">
      <ControlsColumn />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* white frame highlights the embedded viewer inside the demo chrome */}
        <iframe
          ref={attachIframe}
          src={APP_URL}
          title="TreDeSpace"
          className="min-h-0 flex-1 border-2 border-white bg-black"
        />
        <LogConsole className="h-[220px] border-slate-800 border-t" />
      </div>
    </div>
  );
}

/** Demo host page: drives the viewer through the postMessage API via the
 *  copy-paste SDK. Two host modes on the same page — default embeds the app as
 *  an iframe; ?dialog=1 is for when this page itself is HOSTED INSIDE the
 *  viewer (External app panel / dialog): no iframe, just actions + console,
 *  driving window.parent. Shipped with the build at <app>/demo/ . */
export function DemoApp() {
  return (
    <DemoProvider>
      <DemoShell />
    </DemoProvider>
  );
}
