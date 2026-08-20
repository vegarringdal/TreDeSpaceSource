import { consoleActions } from '../../components/panels/console/console.actions';
import { LogCollector } from './LogCollector';
import type { ProgressCallback, resolveFN, SqlExecuteOption, SqlWorkerResult, WorkerMessageEvent } from './types';

/**
 * each client have own worker..
 * all depends how you need to call it
 */
export class SqliteWorkerClient {
  #workerThread: Worker | null = null;
  #filePromiseLocks: Set<resolveFN> = new Set();
  #internalId = 0;
  #responses: Map<number, (value: SqlWorkerResult) => void> = new Map();
  #progressCallback: Map<number, ProgressCallback> = new Map();
  #sharedModeEnabled = false;

  #getNextId() {
    this.#internalId++;
    if (this.#internalId > 1_000_000) {
      this.#internalId = 0;
    }
    return this.#internalId;
  }

  #getWorker() {
    // dont create if its not connected
    if (!this.#workerThread) {
      this.#workerThread = new Worker(new URL('./sqliteWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.#workerThread.onmessage = (e) => {
        const data = e.data as WorkerMessageEvent;
        if (data.type === 'RESULT') {
          const r = this.#responses.get(data.id);

          //cleanup
          this.#responses.delete(data.id);
          this.#progressCallback.delete(data.id);

          if (r) {
            r(data.result);
          } else {
            console.error('dont know who to send result to', data);
          }

          return;
        }

        if (data.type === 'PROGRESS') {
          const r = this.#progressCallback.get(data.id);
          if (r) {
            r(data.result.type, data.result.no, data.result.total);
          }
          return;
        }

        if (data.type === 'SHARED_MODE_ENABLED') {
          this.#sharedModeEnabled = true;
          return;
        }

        if (data.type === 'SHARED_MODE_DISABLED') {
          this.#sharedModeEnabled = false;
          return;
        }

        console.error('unknown response', data);
      };
    }
    return this.#workerThread;
  }

  /**
   * this will kill all sql running in worker..
   */
  killWorkerThread() {
    // terminate and cleanup/end
    this.#workerThread?.terminate();
    this.#workerThread = null;
    this.#filePromiseLocks.forEach((e) => {
      e(null);
    });
    this.#filePromiseLocks.clear();
    this.#responses.forEach((r) => {
      r({
        data: null,
        columns: [],
        logs: [],
        err: { err: null, msg: 'worker killed' },
        execTimeWorker: 0,
        execTime: 0,
      });
    });
    this.#responses.clear();
    this.#internalId = 0;
    this.#progressCallback.clear();
  }

  #execute(
    options: SqlExecuteOption,
    id: number,
    logtime: readonly [number, number],
    progressCallback?: ProgressCallback,
  ): Promise<SqlWorkerResult> {
    return new Promise((r) => {
      const worker = this.#getWorker();

      this.#responses.set(id, r);

      // configure progress

      if (progressCallback && options.progressSize) {
        this.#progressCallback.set(id, progressCallback);
      } else {
        // disable it, nothing to send back too
        options.progressSize = 0;
      }

      worker?.postMessage({
        id,
        logtime,
        options,
        type: 'EXECUTE',
      });
    });
  }

  constructor() {
    // init
    this.#getWorker();
  }

  postChannel(channel: string, message: unknown) {
    const c = new BroadcastChannel(channel);
    c.postMessage(message);
  }

  async execute(options: SqlExecuteOption, progressCallback?: ProgressCallback) {
    const p = performance.now();
    const id = this.#getNextId();
    const log_before_work = new LogCollector(id, 'bWorker', options.collectLog, options.debugPrint, [
      performance.timeOrigin + p,
      performance.timeOrigin + p,
    ]);
    let log_after_work: LogCollector | null = null;
    const files = new Set<string>();
    // a blank main path = the in-memory scratch db (no file, nothing to lock)
    if (options.mainDbPath) {
      files.add(options.mainDbPath);
    }
    options.additionalDbPaths.map((e) => files.add(e));

    // validate if lock mode is possible
    if (options.lockmode === 'shared' && !this.#sharedModeEnabled) {
      log_before_work.log('Shared mode disabled, will use exclusive mode');
      options.lockmode = 'exclusive';
    }

    const resolves: resolveFN[] = [];
    const locks: Promise<unknown>[] = [];
    const filesInUse: string[] = [];
    const lockTimeout = options.lockTimeout || 0;
    const lockMode = options.lockmode || 'exclusive';

    let finalResult: SqlWorkerResult = {
      data: null,
      columns: [],
      logs: [],
      err: null,
      execTimeWorker: 0,
      execTime: 0,
    };

    const lockOptions: LockOptions = {
      ifAvailable: lockTimeout === 0,
      mode: lockMode || 'exclusive',
    };
    if (lockTimeout > 0) {
      const controller = new AbortController();
      setTimeout(() => controller?.abort(), lockTimeout);
      lockOptions.signal = controller.signal;
    }

    // No files at all (blank main = in-memory scratch db, nothing attached):
    // there is nothing to lock, so the lock callbacks below would never run and
    // the worker would silently never be called — run it directly instead.
    if (files.size === 0) {
      consoleActions.log('info', 'SQL: no main or attached db — running on the in-memory scratch db');
      log_before_work.log('No files to lock (in-memory scratch db) — calling worker directly');
      finalResult = await this.#execute(options, id, log_before_work.transferAbsoluteLogTimes(), progressCallback);
      const logimer = finalResult.transferedLogtime || [performance.timeOrigin + p, performance.timeOrigin + p];
      log_after_work = new LogCollector(id, 'aWorker', options.collectLog, options.debugPrint, logimer);
      log_after_work.log('data recived');
    }

    Array.from(files).forEach((e) => {
      consoleActions.log('info', `SQL: weblock ${lockMode} → ${e}`);
      log_before_work.log(`Locking: ${e}, lockmode: ${lockMode}`);
      locks.push(
        navigator.locks.request(e, lockOptions, (lock) => {
          // the lock is held for as long as this promise is pending; `release`
          // is what hands it back (kept in #filePromiseLocks so killing the
          // worker can unlock everything)
          let release!: resolveFN;
          const held = new Promise((r) => {
            release = r;
          });

          if (!lock) {
            log_before_work.log(`File in use: ${e}`);
            filesInUse.push(e);
          }
          log_before_work.log(`Lock ok: ${e}`);
          resolves.push(release);
          this.#filePromiseLocks.add(release);

          // the LAST file to be locked drives the actual work, then releases
          // every lock at once
          if (resolves.length === files.size) {
            void (async () => {
              if (filesInUse.length === 0) {
                log_before_work.log(`All locks aquired, calling worker`);
                finalResult = await this.#execute(
                  options,
                  id,
                  log_before_work.transferAbsoluteLogTimes(),
                  progressCallback,
                );
              } else {
                log_before_work.log(`Locking failed`);
              }
              const logimer = finalResult.transferedLogtime || [performance.timeOrigin + p, performance.timeOrigin + p];
              log_after_work = new LogCollector(id, 'aWorker', options.collectLog, options.debugPrint, logimer);
              log_after_work.log(`data recived - unlocking`);
              resolves.forEach((r) => {
                // release/cleanup class refs
                r(null);
                this.#filePromiseLocks.delete(r);
              });
              log_after_work.log(`unlocking done`);
            })();
          }
          return held;
        }),
      );
    });

    await Promise.allSettled(locks);

    // add total time

    finalResult.execTimeWorker = finalResult.execTimeWorker || 0;
    finalResult.execTime = finalResult.execTime || 0;
    finalResult.columns = finalResult.columns || [];

    if (filesInUse.length) {
      consoleActions.log('warn', `SQL: files in use (locked elsewhere): ${filesInUse.join(', ')}`);
      finalResult.data = null;

      finalResult.err = {
        err: null,
        msg: `Files in use: ${filesInUse.join(', ')}`,
      };
    }

    let afterwork_logs: string[] = [];
    if (log_after_work) {
      log_after_work.log(`done`);
      afterwork_logs = log_after_work.getResult().logs;
    }

    let final_logs: string[] = [];
    if (finalResult.logs) {
      final_logs = finalResult.logs.concat(afterwork_logs);
    }

    finalResult.logs = log_before_work.getResult().logs.concat(final_logs);

    finalResult.execTime = performance.now() - p;

    return finalResult;
  }
}
