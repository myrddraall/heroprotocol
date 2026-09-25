import type { AnalyserRunRecord } from '../model/records.js';
import { TableSink, withProgress } from './context.js';
import { NO_PARAMS, paramsHash } from './paramsHash.js';
import type { AnalyserRegistry } from './registry.js';
import type {
  AnalyserContext,
  AnalyserMode,
  AnalyserRegistration,
  AnalyserRow,
  AnalyserRows,
  AnalyserStatus,
  AnyAnalyser,
  RunClock,
} from './types.js';

export const systemClock: RunClock = {
  now: () => new Date().toISOString(),
  ms: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
};

/** One analyser's output: the run record plus its rows, stamped and ready to store. */
export interface AnalyserOutput {
  readonly run: AnalyserRunRecord;
  /** Table → rows, each carrying `replayId` (and `paramsHash` when parameterized). Empty on failure. */
  readonly rows: Readonly<Record<string, readonly AnalyserRow[]>>;
}

export interface RunOptions {
  readonly registry: AnalyserRegistry;
  readonly ctx: AnalyserContext;
  /** Which modes to run, in this order. */
  readonly modes: readonly AnalyserMode[];
  /** Runs already recorded for this replay; fresh ones are reused, stale ones recomputed. */
  readonly existing?: readonly AnalyserRunRecord[];
  /** Rows produced earlier in this ingest, so dependencies can read them. */
  readonly sink?: TableSink;
  readonly onStatus?: (status: AnalyserStatus) => void;
  /** Called with each output as soon as it is computed, so a host can commit incrementally. */
  readonly onComputed?: (output: AnalyserOutput) => void | Promise<void>;
  readonly clock?: RunClock;
}

export interface RunOutcome {
  /** Every analyser computed this run, including failures. */
  readonly computed: readonly AnalyserOutput[];
  /** Ids whose fresh run was reused instead. */
  readonly reused: readonly string[];
}

/** True when a recorded run can stand in for running the analyser again. */
export function isFresh(
  run: AnalyserRunRecord | undefined,
  analyser: AnyAnalyser,
): run is AnalyserRunRecord {
  return run !== undefined && run.error === null && run.analyserVersion === analyser.version;
}

/** Whether a Dexie schema's primary key includes `paramsHash` — one row set per parameterization. */
export function keyedByParams(schema: string): boolean {
  return schema.split(',')[0]!.includes('paramsHash');
}

/**
 * Stamp `replayId` onto rows, plus `paramsHash` when the run has params or the table is
 * keyed by it (then `'-'` marks the unparameterized set), and drop undeclared tables.
 */
export function stampRows(
  analyser: AnyAnalyser,
  replayId: string,
  hash: string,
  rows: AnalyserRows,
): Record<string, AnalyserRow[]> {
  const out: Record<string, AnalyserRow[]> = {};
  for (const [table, schema] of Object.entries(analyser.tables)) {
    const list = rows[table];
    if (!list) continue;
    const withHash = hash !== NO_PARAMS || keyedByParams(schema);
    out[table] = list.map((r) =>
      withHash ? { ...r, replayId, paramsHash: hash } : { ...r, replayId },
    );
  }
  return out;
}

/**
 * Run one analyser and package the outcome. A throwing analyser yields a run record
 * with `error` and no rows; it never propagates.
 */
export async function runAnalyser(
  analyser: AnyAnalyser,
  ctx: AnalyserContext,
  params: unknown,
  options: {
    readonly mode?: AnalyserMode;
    readonly onStatus?: (s: AnalyserStatus) => void;
    readonly clock?: RunClock;
  } = {},
): Promise<AnalyserOutput> {
  const clock = options.clock ?? systemClock;
  const mode = options.mode ?? analyser.mode;
  const hash = paramsHash(params);
  const status = (s: Omit<AnalyserStatus, 'analyserId' | 'mode' | 'paramsHash'>): void =>
    options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: hash, ...s });

  status({ state: 'running' });
  const started = clock.ms();
  const runCtx = withProgress(ctx, (current, total) =>
    status({ state: 'running', progress: { current, total } }),
  );
  const base = {
    replayId: ctx.replay.id,
    analyserId: analyser.id,
    paramsHash: hash,
    analyserVersion: analyser.version,
  };
  try {
    const produced = await analyser.run(runCtx, params);
    const rows = stampRows(analyser, ctx.replay.id, hash, produced ?? {});
    const ms = clock.ms() - started;
    status({ state: 'done', ms });
    return { run: { ...base, error: null, computedAt: clock.now(), ms }, rows };
  } catch (err) {
    const ms = clock.ms() - started;
    const error = err instanceof Error ? err.message : String(err);
    status({ state: 'failed', ms, error });
    return { run: { ...base, error, computedAt: clock.now(), ms }, rows: {} };
  }
}

/**
 * Run every registered analyser of the given modes, unparameterized, in dependency
 * order. A dependency outside the requested modes is satisfied by its recorded fresh
 * run (its rows are in the store) or computed too. Each analyser's failure is isolated
 * to its own run record; dependents of a failed analyser are skipped with a record of
 * their own. Rows are appended to the sink as they are produced so later analysers can
 * read them.
 */
export async function runAnalysers(options: RunOptions): Promise<RunOutcome> {
  const { registry, ctx, modes } = options;
  const clock = options.clock ?? systemClock;
  registry.validate();
  const sink = options.sink ?? new TableSink();

  const existing = new Map<string, AnalyserRunRecord>();
  for (const run of options.existing ?? []) {
    if (run.replayId === ctx.replay.id && run.paramsHash === NO_PARAMS)
      existing.set(run.analyserId, run);
  }

  const wanted = new Set(modes);
  const targets = registry.list().filter((r) => wanted.has(r.mode));
  const plan: AnalyserRegistration[] = registry.order(targets.map((r) => r.analyser.id));

  const failed = new Set<string>();
  const computed: AnalyserOutput[] = [];
  const reused: string[] = [];

  for (const reg of plan) {
    const { analyser, mode } = reg;
    const prior = existing.get(analyser.id);
    if (isFresh(prior, analyser)) {
      reused.push(analyser.id);
      options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: NO_PARAMS, state: 'cached' });
      continue;
    }
    options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: NO_PARAMS, state: 'queued' });
    const brokenDep = (analyser.dependsOn ?? []).find((d) => failed.has(d));
    let output: AnalyserOutput;
    if (brokenDep !== undefined) {
      const error = `dependency '${brokenDep}' failed`;
      options.onStatus?.({
        analyserId: analyser.id,
        mode,
        paramsHash: NO_PARAMS,
        state: 'failed',
        error,
      });
      output = {
        run: {
          replayId: ctx.replay.id,
          analyserId: analyser.id,
          paramsHash: NO_PARAMS,
          analyserVersion: analyser.version,
          error,
          computedAt: clock.now(),
          ms: 0,
        },
        rows: {},
      };
    } else {
      output = await runAnalyser(analyser, ctx, undefined, {
        mode,
        clock,
        ...(options.onStatus ? { onStatus: options.onStatus } : {}),
      });
    }
    computed.push(output);
    if (output.run.error === null) {
      for (const [table, rows] of Object.entries(output.rows)) sink.add(table, rows);
    } else {
      failed.add(analyser.id);
    }
    await options.onComputed?.(output);
  }
  return { computed, reused };
}
