import { createRegistry } from '../analysers/registry.js';
import type { AnyAnalyser, RegisterOptions } from '../analysers/types.js';
import { reanalyse } from '../db/maintenance.js';
import { DEFAULT_DB_NAME, HeroDb } from '../db/HeroDb.js';
import { analyse } from '../ingest/lazy.js';
import { ingestInline } from '../ingest/pipeline.js';
import type { AnalyserSummary, WorkerRequest, WorkerResponse, WorkerScope } from './protocol.js';

export interface WorkerAnalyser {
  readonly analyser: AnyAnalyser;
  readonly options?: RegisterOptions;
}

export interface CreateWorkerOptions {
  /** Analysers baked into this worker; plain analysers or `{ analyser, options }` for a mode override. */
  readonly analysers?: readonly (AnyAnalyser | WorkerAnalyser)[];
  /** Services exposed to analysers through `ctx.services`. */
  readonly services?: Readonly<Record<string, unknown>>;
  /** Database name if the client never sends `init` (default `heroprotocol`). */
  readonly dbName?: string;
}

export interface WorkerHandle {
  /** Stop listening and close the database. */
  dispose(): Promise<void>;
}

const isRequest = (data: unknown): data is WorkerRequest =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { type?: unknown }).type === 'string';

/**
 * Run the ingest worker over `scope` — `self` inside a web worker (the default), or
 * any message port. A consumer's worker entry is a few lines:
 *
 * ```ts
 * import { createWorker } from '@myrddraall/heroprotocol-db/worker';
 * createWorker({ analysers: [...builtins, mine] });
 * ```
 */
export function createWorker(options: CreateWorkerOptions = {}, scope?: WorkerScope): WorkerHandle {
  const target: WorkerScope = scope ?? (globalThis as unknown as WorkerScope);
  const registry = createRegistry();
  for (const entry of options.analysers ?? []) {
    if ('analyser' in entry && typeof (entry as WorkerAnalyser).analyser === 'object') {
      const e = entry as WorkerAnalyser;
      registry.register(e.analyser, e.options ?? {});
    } else {
      registry.register(entry as AnyAnalyser);
    }
  }
  registry.validate();
  const summaries: AnalyserSummary[] = registry
    .list()
    .map((r) => ({ id: r.analyser.id, mode: r.mode, version: r.analyser.version }));

  let db: HeroDb | undefined;
  const database = (): HeroDb => (db ??= new HeroDb(options.dbName ?? DEFAULT_DB_NAME));
  const post = (message: WorkerResponse): void => target.postMessage(message);
  const services = options.services;

  const onMessage = async (event: { readonly data: unknown }): Promise<void> => {
    const req = event.data;
    if (!isRequest(req)) return;
    switch (req.type) {
      case 'init':
        if (db && db.name !== req.dbName) {
          db.close();
          db = undefined;
        }
        db ??= new HeroDb(req.dbName);
        post({ type: 'ready', analysers: summaries });
        return;
      case 'ingest': {
        const handle = ingestInline(database(), new Uint8Array(req.bytes), {
          fileName: req.fileName,
          keepFile: req.keepFile,
          registry,
          ...(services ? { services } : {}),
          onStatus: (status) => post({ type: 'ingest-status', ref: req.ref, status }),
        });
        handle.ready.then(
          (result) => post({ type: 'ingest-ready', ref: req.ref, result }),
          () => undefined, // `complete` reports the failure
        );
        try {
          const result = await handle.complete;
          post({ type: 'ingest-complete', ref: req.ref, result });
        } catch (err) {
          post({
            type: 'failed',
            ref: req.ref,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'analyse':
        try {
          const row = await analyse(database(), req.replayId, req.analyserId, {
            registry,
            params: req.params,
            force: req.force === true,
            ...(services ? { services } : {}),
            onStatus: (status) =>
              post({ type: 'analyser-status', ref: req.ref, replayId: req.replayId, status }),
          });
          post({ type: 'analysed', ref: req.ref, row });
        } catch (err) {
          post({
            type: 'failed',
            ref: req.ref,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      case 'reanalyse':
        try {
          const rows = await reanalyse(database(), {
            registry,
            ...(req.replayId !== undefined ? { replayId: req.replayId } : {}),
            ...(services ? { services } : {}),
            onStatus: (replayId, status) =>
              post({ type: 'analyser-status', ref: req.ref, replayId, status }),
          });
          post({ type: 'reanalysed', ref: req.ref, rows });
        } catch (err) {
          post({
            type: 'failed',
            ref: req.ref,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      case 'close':
        db?.close();
        db = undefined;
        post({ type: 'closed' });
        target.close?.();
        return;
      default:
        return;
    }
  };

  target.addEventListener('message', (event) => {
    void onMessage(event);
  });
  target.start?.();
  post({ type: 'ready', analysers: summaries });

  return {
    async dispose(): Promise<void> {
      db?.close();
      db = undefined;
    },
  };
}
