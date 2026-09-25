import type {
  AnalyserRunRecord,
  NormalizedReplay,
  RecordOf,
  ReplayCollectionName,
  ReplayRecord,
} from '../model/records.js';

/**
 * When an analyser runs.
 * - `ready`: at ingest, over the in-memory replay, before the replay is considered ready.
 * - `background`: at ingest, after ready, committed as it finishes.
 * - `lazy`: on first request, from the persisted model, then cached.
 * The modes are ordered; a dependency may only point at an equal or earlier mode.
 */
export type AnalyserMode = 'ready' | 'background' | 'lazy';

export const MODE_ORDER: Readonly<Record<AnalyserMode, number>> = {
  ready: 0,
  background: 1,
  lazy: 2,
};

export type StatSupport = 'full' | 'partial' | 'flawed' | 'none';

export interface StatSupportEntry {
  readonly support: StatSupport;
  readonly note: string;
}

/** Stat name → how far this replay's build supports it (absent = full). */
export type StatSupportTable = Readonly<Record<string, StatSupportEntry>>;

/** Equality filter over a table's fields. */
export type Where<T> = Partial<T>;

/** A row an analyser emits: any plain object; the framework stamps `replayId` (and `paramsHash`). */
export type AnalyserRow = object;

/** What `run()` returns: rows per declared table. Tables not mentioned get no rows. */
export type AnalyserRows = Readonly<Record<string, readonly AnalyserRow[]>>;

/** Stamped on every stored analyser row. */
export interface StampedRow {
  readonly replayId: string;
  /** Present on rows of parameterized runs only. */
  readonly paramsHash?: string;
}

/**
 * What an analyser sees. At ingest `read()` is backed by the in-memory replay and by the
 * rows earlier analysers produced; lazily it is backed by the store — the same analyser
 * code runs in both.
 */
export interface AnalyserContext {
  readonly replay: ReplayRecord;
  /** A core collection of this replay, optionally filtered by field equality. */
  read<K extends ReplayCollectionName>(
    collection: K,
    where?: Where<RecordOf<K>>,
  ): Promise<readonly RecordOf<K>[]>;
  /** An analyser table's rows for this replay (a dependency's output), optionally filtered. */
  readTable<T extends AnalyserRow = AnalyserRow>(
    table: string,
    where?: Where<T>,
  ): Promise<readonly T[]>;
  readonly statSupport: StatSupportTable;
  /** Optional services a host registers (hero data, …). */
  readonly services: Readonly<Record<string, unknown>>;
  /** Fine-grained progress for long analysers; optional to call. */
  progress(current: number, total: number): void;
}

export interface AnalyserCacheOptions {
  /** Bound for parameterized analysers whose parameter space can grow without limit. */
  readonly maxEntries?: number;
}

/**
 * A versioned pure function over the normalized replay that writes rows into tables
 * it declares. Replay data never changes, so the rows are a function of
 * (replay, params); the run is recorded under that key.
 */
export interface Analyser<TRows extends AnalyserRows = AnalyserRows, TParams = void> {
  /** Namespaced: `@myrddraall/score-screen`, `com.example.my-stat`. */
  readonly id: string;
  /** Bump when the tables or their meaning change; stale runs are recomputed. */
  readonly version: number;
  /**
   * The analyser's tables as Dexie schema strings. Names must be unique across the
   * database, and every primary key must start with `replayId` so a replay's rows are one
   * range (`[replayId+slot]`, `[replayId+seq]`, or just `replayId` for one row per replay).
   * Parameterized analysers include `paramsHash` in the key.
   */
  readonly tables: Readonly<Record<string, string>>;
  /** Core collections it reads; lets a store load only those. */
  readonly inputs: readonly ReplayCollectionName[];
  readonly dependsOn?: readonly string[];
  readonly mode: AnalyserMode;
  readonly cache?: AnalyserCacheOptions;
  run(ctx: AnalyserContext, params: TParams): TRows | Promise<TRows>;
}

export type AnyAnalyser = Analyser<AnalyserRows, unknown>;

export interface RegisterOptions {
  /** Override the analyser's declared mode for this registry. */
  readonly mode?: AnalyserMode;
}

export interface AnalyserRegistration {
  readonly analyser: AnyAnalyser;
  /** Effective mode after any override. */
  readonly mode: AnalyserMode;
}

export type AnalyserState = 'queued' | 'running' | 'done' | 'cached' | 'failed';

/** One transition in an analyser's life within a run; streamed to the host. */
export interface AnalyserStatus {
  readonly analyserId: string;
  readonly mode: AnalyserMode;
  readonly paramsHash: string;
  readonly state: AnalyserState;
  readonly ms?: number;
  readonly error?: string;
  readonly progress?: { readonly current: number; readonly total: number };
}

export interface RunClock {
  /** ISO timestamp for `computedAt`. */
  now(): string;
  /** Milliseconds, for durations. */
  ms(): number;
}

export type { AnalyserRunRecord, NormalizedReplay };
