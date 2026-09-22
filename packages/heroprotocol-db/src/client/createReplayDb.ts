import { createRegistry } from '../analysers/registry.js';
import type { AnalyserStatus, AnyAnalyser } from '../analysers/types.js';
import { deleteReplay } from '../db/write.js';
import { DEFAULT_DB_NAME, HeroDb } from '../db/HeroDb.js';
import { listReplays, pruneReplays, reanalyse as reanalyseInline } from '../db/maintenance.js';
import { analyse as analyseInline } from '../ingest/lazy.js';
import { ingestInline } from '../ingest/pipeline.js';
import type { IngestResult } from '../ingest/pipeline.js';
import type { IngestStatus } from '../ingest/status.js';
import type { DerivedRecord, ReplayRecord } from '../model/records.js';
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

export interface ReplayDbClient {
  /** The main-thread Dexie instance: direct reads and `liveQuery`. */
  readonly db: HeroDb;
  /** Resolves when the worker has announced its analysers. */
  readonly ready: Promise<readonly AnalyserSummary[]>;
  ingest(bytes: Uint8Array | ArrayBuffer, options: IngestJobOptions): IngestJob;
  analyse(
    replayId: string,
    analyserId: string,
    options?: ClientAnalyseOptions,
  ): Promise<DerivedRecord>;
  /** Several analysers at once (e.g. prefetch), in parallel. */
  analyseAll(
    replayId: string,
    analyserIds: readonly string[],
    options?: ClientAnalyseOptions,
  ): Promise<DerivedRecord[]>;
  reanalyse(replayId?: string): Promise<DerivedRecord[]>;
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
  const db = new HeroDb(dbName);
  if (options.inline) return createInlineClient(db, options);

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
  return createWorkerClient(db, dbName, worker);
}

interface Pending {
  readonly onResponse: (res: WorkerResponse) => void;
}

function createWorkerClient(db: HeroDb, dbName: string, worker: WorkerLike): ReplayDbClient {
  const pending = new Map<number, Pending>();
  let nextRef = 1;
  let resolveReady!: (a: readonly AnalyserSummary[]) => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<readonly AnalyserSummary[]>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => undefined);
  let closed = false;

  worker.addEventListener('message', (event) => {
    const res = event.data;
    if (!isResponse(res)) return;
    if (res.type === 'ready') {
      resolveReady(res.analysers);
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

  return {
    db,
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
      return request<DerivedRecord>(
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
          else if (res.type === 'analysed') done(res.row);
        },
      );
    },
    analyseAll(replayId, ids, analyseOptions) {
      return Promise.all(ids.map((id) => this.analyse(replayId, id, analyseOptions)));
    },
    reanalyse(replayId) {
      return request<DerivedRecord[]>(
        (ref) => ({ type: 'reanalyse', ref, ...(replayId !== undefined ? { replayId } : {}) }),
        undefined,
        (res, done) => {
          if (res.type === 'reanalysed') done([...res.rows]);
        },
      );
    },
    listReplays: () => listReplays(db),
    deleteReplay: (id) => deleteReplay(db, id),
    pruneReplays: (keep) => pruneReplays(db, { keep }),
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
      db.close();
    },
  };
}

function createInlineClient(db: HeroDb, options: ReplayDbOptions): ReplayDbClient {
  const registry = createRegistry(options.analysers ?? []);
  registry.validate();
  const services = options.services;
  const summaries = registry
    .list()
    .map((r) => ({ id: r.analyser.id, mode: r.mode, version: r.analyser.version }));
  return {
    db,
    ready: Promise.resolve(summaries),
    ingest(bytes, jobOptions) {
      const listeners = new Set<(s: IngestStatus) => void>();
      if (jobOptions.onStatus) listeners.add(jobOptions.onStatus);
      let latest: IngestStatus | undefined;
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
      return {
        ready: handle.ready,
        complete: handle.complete,
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
      return analyseInline(db, replayId, analyserId, {
        registry,
        params: analyseOptions.params,
        force: analyseOptions.force === true,
        ...(services ? { services } : {}),
        ...(analyseOptions.onStatus ? { onStatus: analyseOptions.onStatus } : {}),
      });
    },
    analyseAll(replayId, ids, analyseOptions) {
      return Promise.all(ids.map((id) => this.analyse(replayId, id, analyseOptions)));
    },
    reanalyse: (replayId) =>
      reanalyseInline(db, {
        registry,
        ...(replayId !== undefined ? { replayId } : {}),
        ...(services ? { services } : {}),
      }),
    listReplays: () => listReplays(db),
    deleteReplay: (id) => deleteReplay(db, id),
    pruneReplays: (keep) => pruneReplays(db, { keep }),
    async close() {
      db.close();
    },
  };
}
