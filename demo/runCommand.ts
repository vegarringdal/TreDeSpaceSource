import type { Result } from '../api/tredespace-client';
import type { LogCls } from './useDemoLog';

export type RunFn = (name: string, req: unknown, fn: () => Promise<Result<unknown>>) => Promise<void>;

/** Build the demo's command runner: logs the request, then the full response
 *  (or the thrown/returned error), plus any `missed` fullnames. */
export function makeRun(line: (cls: LogCls, text: string) => void): RunFn {
  return async (name, req, fn) => {
    line('', `→ ${name} ${JSON.stringify(req)}`);
    try {
      const res = await fn();
      if (res.error) {
        line('err', `← error ${res.error.code}: ${res.error.msg}`);
        return;
      }

      const data = res.data;
      line('out', `← ${JSON.stringify(data)}`);
      const missed = (data as { missed?: string[] })?.missed;
      if (missed?.length) {
        line('err', `  missed: ${missed.join(', ')}`);
      } else {
        line('ok', '  ok');
      }
    } catch (e) {
      line('err', `← ${(e as Error).message}`);
    }
  };
}
