import { createRegistry } from '../analysers/registry.js';
import type { AnalyserOutput } from '../analysers/runner.js';
import type { AnalyserStatus, AnyAnalyser } from '../analysers/types.js';
import { deleteReplay } from '../db/write.js';
import { DEFAULT_DB_NAME, HeroDb } from '../db/HeroDb.js';
import { listReplays, pruneReplays, reanalyse as reanalyseInline } from '../db/maintenance.js';
import { analyse as analyseInline } from '../ingest/lazy.js';
import { ingestInline } from '../ingest/pipeline.js';
import type { IngestResult } from '../ingest/pipeline.js';
import type { IngestStatus } from '../ingest/status.js';
import type { AnalyserRunRecord, ReplayRecord } from '../model/records.js';
import type {
  AnalyserSummary,
  WorkerLike,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol.js';

export interface ReplayDbOptions {
  /** Database name (default `heroprotocol`). Main thread and worker open the same one. */
  readonly dbName?: string;
  /** A worker (or a factory for one) whose entry called `createWorker`. */
  readonly worker?: WorkerLike | (() => WorkerLike);
  /**
   * URL of a module worker script instead of `worker`, for bundlers whose worker
   * handling wants a URL (e.g. Vite's `?worker&url`).
   */
  readonly workerUrl?: string | URL;
  /**
   * Run everything on the calling thread — no worker at all. For tests, Node, and
   * environments without workers. `analysers` are registered in-process.
   */
  readonly inline?: boolean;
  readonly analysers?: readonly AnyAnalyser[];
  readonly services?: Readonly<Record<string, unknown>>;
}

export interface IngestJobOptions {
  readonly fileName: string;
  readonly keepFile?: boolean;
  readonly onStatus?: (status: IngestStatus) => void;
}

export interface IngestJob {
  readonly ready: Promise<IngestResult>;
  readonly complete: Promise<IngestResult>;
  /** Subscribe to status snapshots; returns an unsubscribe function. */
  status(listener: (status: IngestStatus) => void): () => void;
  /** The latest snapshot seen, if any. */
  readonly latest: IngestStatus | undefined;
}

export interface ClientAnalyseOptions {
  readonly params?: unknown;
  readonly force?: boolean;
  readonly onStatus?: (status: AnalyserStatus) => void;
}

/** What `ready` resolves with: the worker's analysers and their tables. */
export interface ReplayDbInfo {
  readonly analysers: readonly AnalyserSummary[];
  readonly tables: Readonly<Record<string, string>>;
}

export interface ReplayDbClient {
  /**
   * The main-thread Dexie instance — the core stores plus every analyser table — for
   * direct reads and `liveQuery`. Available once `ready` has resolved (the schema comes
   * from the worker's announcement); accessing it earlier throws.
   */
  readonly db: HeroDb;
  /** Resolves when the database is open with the worker's schema. */
  readonly ready: Promise<ReplayDbInfo>;
  ingest(bytes: Uint8Array | ArrayBuffer, options: IngestJobOptions): IngestJob;
  /** Run (or fetch the cached rows of) one analyser; the rows are also in its tables. */
  analyse(
    replayId: string,
    analyserId: string,
    options?: ClientAnalyseOptions,
  ): Promise<AnalyserOutput>;
  /** Several analysers at once (e.g. prefetch), in parallel. */
  analyseAll(
    replayId: string,
    analyserIds: readonly string[],
    options?: ClientAnalyseOptions,
  ): Promise<AnalyserOutput[]>;
  reanalyse(replayId?: string): Promise<AnalyserRunRecord[]>;
  listReplays(): Promise<ReplayRecord[]>;
  deleteReplay(replayId: string): Promise<void>;
  pruneReplays(keep: number): Promise<string[]>;
  close(): Promise<void>;
}

interface WorkerCtor {
  new (url: string | URL, options?: { type?: 'module' | 'classic' }): WorkerLike;
}

const isResponse = (data: unknown): data is WorkerResponse =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { type?: unknown }).type === 'string';

/**
 * Create the main-thread client. Exactly one of `worker`, `workerUrl` or
 * `inline: true` chooses where the pipeline runs; the returned `db` is always a
 * main-thread Dexie instance for reads and `liveQuery`.
 */
export function createReplayDb(options: ReplayDbOptions = {}): ReplayDbClient {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  if (options.inline) return createInlineClient(dbName, options);

  let worker: WorkerLike;
  if (typeof options.worker === 'function') worker = options.worker();
  else if (options.worker) worker = options.worker;
  else if (options.workerUrl !== undefined) {
    const Ctor = (globalThis as unknown as { Worker?: WorkerCtor }).Worker;
    if (!Ctor)
      throw new Error('createReplayDb: workerUrl given but no Worker constructor exists here');
    worker = new Ctor(options.workerUrl, { type: 'module' });
  } else {
    throw new Error('createReplayDb: pass `worker`, `workerUrl`, or `inline: true`');
  }
  return createWorkerClient(dbName, worker);
}

interface Pending {
  readonly onResponse: (res: WorkerResponse) => void;
}

function createWorkerClient(dbName: string, worker: WorkerLike): ReplayDbClient {
  const pending = new Map<number, Pending>();
  let nextRef = 1;
  let db: HeroDb | undefined;
  let resolveReady!: (info: ReplayDbInfo) => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<ReplayDbInfo>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => undefined);
  let closed = false;

  worker.addEventListener('message', (event) => {
    const res = event.data;
    if (!isResponse(res)) return;
    if (res.type === 'ready') {
      HeroDb.open(dbName, res.tables).then(
        (opened) => {
          db ??= opened;
          if (db !== opened) opened.close();
          resolveReady({ analysers: res.analysers, tables: res.tables });
        },
        (err: unknown) => rejectReady(err),
      );
      return;
    }
    if (res.type === 'closed') return;
    pending.get(res.ref)?.onResponse(res);
  });
  worker.addEventListener('error', (event) => {
    const err = new Error(event.message ?? 'worker error');
    rejectReady(err);
    for (const p of pending.values())
      p.onResponse({ type: 'failed', ref: -1, message: err.message });
    pending.clear();
  });
  worker.start?.();
  worker.postMessage({ type: 'init', dbName });

  const send = (req: WorkerRequest, transfer?: ArrayBuffer[]): void => {
    if (closed) throw new Error('createReplayDb: client is closed');
    if (transfer) worker.postMessage(req, transfer);
    else worker.postMessage(req);
  };
  const request = <T>(
    build: (ref: number) => WorkerRequest,
    transfer: ArrayBuffer[] | undefined,
    handle: (res: WorkerResponse, done: (value: T) => void, fail: (err: Error) => void) => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const ref = nextRef++;
      const finish = (): void => {
        pending.delete(ref);
      };
      pending.set(ref, {
        onResponse: (res) => {
          if (res.type === 'failed') {
            finish();
            reject(new Error(res.message));
            return;
          }
          handle(
            res,
            (value) => {
              finish();
              resolve(value);
            },
            (err) => {
              finish();
              reject(err);
            },
          );
        },
      });
      send(build(ref), transfer);
    });
  const database = (): HeroDb => {
    if (!db)
      throw new Error('createReplayDb: the database opens when `ready` resolves — await it first');
    return db;
  };

  return {
    get db() {
      return database();
    },
    ready,
    ingest(bytes, jobOptions) {
      const listeners = new Set<(s: IngestStatus) => void>();
      if (jobOptions.onStatus) listeners.add(jobOptions.onStatus);
      let latest: IngestStatus | undefined;
      let resolveReadyJob!: (r: IngestResult) => void;
      let rejectReadyJob!: (e: unknown) => void;
      const readyJob = new Promise<IngestResult>((res, rej) => {
        resolveReadyJob = res;
        rejectReadyJob = rej;
      });
      readyJob.catch(() => undefined);
      const buffer =
        bytes instanceof Uint8Array
          ? bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? (bytes.buffer as ArrayBuffer)
            : (bytes.slice().buffer as ArrayBuffer)
          : bytes;
      const complete = request<IngestResult>(
        (ref) => ({
          type: 'ingest',
          ref,
          bytes: buffer,
          fileName: jobOptions.fileName,
          keepFile: jobOptions.keepFile === true,
        }),
        [buffer],
        (res, done) => {
          if (res.type === 'ingest-status') {
            latest = res.status;
            for (const l of listeners) l(res.status);
          } else if (res.type === 'ingest-ready') resolveReadyJob(res.result);
          else if (res.type === 'ingest-complete') done(res.result);
        },
      );
      complete.catch((err: unknown) => rejectReadyJob(err));
      return {
        ready: readyJob,
        complete,
        status(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        get latest() {
          return latest;
        },
      };
    },
    analyse(replayId, analyserId, analyseOptions = {}) {
      return request<AnalyserOutput>(
        (ref) => ({
          type: 'analyse',
          ref,
          replayId,
          analyserId,
          ...(analyseOptions.params !== undefined ? { params: analyseOptions.params } : {}),
          ...(analyseOptions.force ? { force: true } : {}),
        }),
        undefined,
        (res, done) => {
          if (res.type === 'analyser-status') analyseOptions.onStatus?.(res.status);
          else if (res.type === 'analysed') done(res.output);
        },
      );
    },
    analyseAll(replayId, ids, analyseOptions) {
      return Promise.all(ids.map((id) => this.analyse(replayId, id, analyseOptions)));
    },
    reanalyse(replayId) {
      return request<AnalyserRunRecord[]>(
        (ref) => ({ type: 'reanalyse', ref, ...(replayId !== undefined ? { replayId } : {}) }),
        undefined,
        (res, done) => {
          if (res.type === 'reanalysed') done([...res.runs]);
        },
      );
    },
    listReplays: () => ready.then(() => listReplays(database())),
    deleteReplay: (id) => ready.then(() => deleteReplay(database(), id)),
    pruneReplays: (keep) => ready.then(() => pruneReplays(database(), { keep })),
    async close() {
      if (closed) return;
      closed = true;
      try {
        worker.postMessage({ type: 'close' });
      } catch {
        // already gone
      }
      worker.terminate?.();
      worker.close?.();
      db?.close();
    },
  };
}

function createInlineClient(dbName: string, options: ReplayDbOptions): ReplayDbClient {
  const registry = createRegistry(options.analysers ?? []);
  registry.validate();
  const services = options.services;
  const tables = registry.tables();
  const summaries = registry
    .list()
    .map((r) => ({ id: r.analyser.id, mode: r.mode, version: r.analyser.version }));
  let db: HeroDb | undefined;
  const ready = HeroDb.open(dbName, tables).then((opened): ReplayDbInfo => {
    db = opened;
    return { analysers: summaries, tables };
  });
  ready.catch(() => undefined);
  const database = (): HeroDb => {
    if (!db)
      throw new Error('createReplayDb: the database opens when `ready` resolves — await it first');
    return db;
  };
  const withDb = async <T>(fn: (db: HeroDb) => Promise<T>): Promise<T> => {
    await ready;
    return fn(database());
  };
  return {
    get db() {
      return database();
    },
    ready,
    ingest(bytes, jobOptions) {
      const listeners = new Set<(s: IngestStatus) => void>();
      if (jobOptions.onStatus) listeners.add(jobOptions.onStatus);
      let latest: IngestStatus | undefined;
      let resolveReadyJob!: (r: IngestResult) => void;
      let rejectReadyJob!: (e: unknown) => void;
      const readyJob = new Promise<IngestResult>((res, rej) => {
        resolveReadyJob = res;
        rejectReadyJob = rej;
      });
      readyJob.catch(() => undefined);
      const complete = withDb((db) => {
        const handle = ingestInline(db, bytes, {
          fileName: jobOptions.fileName,
          keepFile: jobOptions.keepFile === true,
          registry,
          ...(services ? { services } : {}),
          onStatus: (s) => {
            latest = s;
            for (const l of listeners) l(s);
          },
        });
        handle.ready.then(resolveReadyJob, () => undefined);
        return handle.complete;
      });
      complete.catch((err: unknown) => rejectReadyJob(err));
      return {
        ready: readyJob,
        complete,
        status(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        get latest() {
          return latest;
        },
      };
    },
    analyse(replayId, analyserId, analyseOptions = {}) {
      return withDb((db) =>
        analyseInline(db, replayId, analyserId, {
          registry,
          params: analyseOptions.params,
          force: analyseOptions.force === true,
          ...(services ? { services } : {}),
          ...(analyseOptions.onStatus ? { onStatus: analyseOptions.onStatus } : {}),
        }),
      );
    },
    analyseAll(replayId, ids, analyseOptions) {
      return Promise.all(ids.map((id) => this.analyse(replayId, id, analyseOptions)));
    },
    reanalyse: (replayId) =>
      withDb(async (db) =>
        (
          await reanalyseInline(db, {
            registry,
            ...(replayId !== undefined ? { replayId } : {}),
            ...(services ? { services } : {}),
          })
        ).map((o) => o.run),
      ),
    listReplays: () => withDb((db) => listReplays(db)),
    deleteReplay: (id) => withDb((db) => deleteReplay(db, id)),
    pruneReplays: (keep) => withDb((db) => pruneReplays(db, { keep })),
    async close() {
      db?.close();
    },
  };
}
