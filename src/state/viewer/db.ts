// Comlink client for the model-database worker. One worker for the app;
// heavy loops (parsing, hierarchy walks, state packing) happen there.
import * as Comlink from 'comlink';
import type { ModelDbApi } from '../../lib/modeldb/modeldbWorker';

export const db = Comlink.wrap<ModelDbApi>(
  new Worker(new URL('../../lib/modeldb/modeldbWorker.ts', import.meta.url), { type: 'module' }),
);

export { transfer } from 'comlink';
