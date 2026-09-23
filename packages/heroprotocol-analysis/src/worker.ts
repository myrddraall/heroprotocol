/**
 * The batteries-included ingest worker: every built-in analyser baked in.
 *
 * ```ts
 * import workerUrl from '@myrddraall/heroprotocol-analysis/worker?worker&url'; // Vite
 * const client = createReplayDb({ workerUrl });
 * ```
 * A consumer that wants its own analysers writes a worker entry with `createWorker`
 * from `@myrddraall/heroprotocol-db/worker` and `builtins` from this package instead.
 */
import { createWorker } from '@myrddraall/heroprotocol-db/worker';
import { builtins } from './builtins.js';

createWorker({ analysers: builtins });

export {};
