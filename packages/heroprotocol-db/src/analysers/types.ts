import type {
  DerivedRecord,
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

/** Equality filter over a collection's fields. */
export type Where<K extends ReplayCollectionName> = Partial<RecordOf<K>>;

/**
 * What an analyser sees. At ingest `read()` is backed by the in-memory normalized
 * replay; lazily it is backed by the store — the same analyser code runs in both.
 */
export interface AnalyserContext {
  readonly replay: ReplayRecord;
  read<K extends ReplayCollectionName>(
    collection: K,
    where?: Where<K>,
  ): Promise<readonly RecordOf<K>[]>;
  /** Results of the analysers this one `dependsOn`, by id. */
  readonly results: Readonly<Record<string, unknown>>;
  readonly statSupport: StatSupportTable;
  /** Optional services a host registers (hero data, ability names, …). */
  readonly services: Readonly<Record<string, unknown>>;
  /** Fine-grained progress for long analysers; optional to call. */
  progress(current: number, total: number): void;
}

export interface AnalyserCacheOptions {
  /** Bound for parameterized analysers whose parameter space can grow without limit. */
  readonly maxEntries?: number;
}

/**
 * A versioned pure function over the normalized replay. Replay data never changes,
 * so the result is a function of (replay, params) and cached under that key.
 */
export interface Analyser<TResult = unknown, TParams = void> {
  /** Namespaced: `@myrddraall/score-screen`, `com.example.my-stat`. */
  readonly id: string;
  /** Bump when the output changes shape or meaning; stale results are recomputed. */
  readonly version: number;
  /** Collections it reads; lets a store load only those. */
  readonly inputs: readonly ReplayCollectionName[];
  readonly dependsOn?: readonly string[];
  readonly mode: AnalyserMode;
  readonly cache?: AnalyserCacheOptions;
  run(ctx: AnalyserContext, params: TParams): TResult | Promise<TResult>;
}

export type AnyAnalyser = Analyser<unknown, unknown>;

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

export type { DerivedRecord, NormalizedReplay };
