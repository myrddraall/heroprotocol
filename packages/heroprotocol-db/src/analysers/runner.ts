import type { DerivedRecord } from '../model/records.js';
import { withResults } from './context.js';
import { NO_PARAMS, paramsHash } from './paramsHash.js';
import type { AnalyserRegistry } from './registry.js';
import type {
  AnalyserContext,
  AnalyserMode,
  AnalyserRegistration,
  AnalyserStatus,
  AnyAnalyser,
  RunClock,
} from './types.js';

export const systemClock: RunClock = {
  now: () => new Date().toISOString(),
  ms: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
};

export interface RunOptions {
  readonly registry: AnalyserRegistry;
  readonly ctx: AnalyserContext;
  /** Which modes to run, in this order. */
  readonly modes: readonly AnalyserMode[];
  /** Results already persisted for this replay; fresh ones are reused, stale ones recomputed. */
  readonly existing?: readonly DerivedRecord[];
  readonly onStatus?: (status: AnalyserStatus) => void;
  readonly clock?: RunClock;
}

export interface RunOutcome {
  /** Rows to persist: every analyser that was computed this run (including failures). */
  readonly computed: readonly DerivedRecord[];
  /** Every result available after the run, fresh or reused, by analyser id. */
  readonly results: Readonly<Record<string, unknown>>;
}

/** True when a stored row can stand in for running the analyser again. */
export function isFresh(
  row: DerivedRecord | undefined,
  analyser: AnyAnalyser,
): row is DerivedRecord {
  return row !== undefined && row.error === null && row.analyserVersion === analyser.version;
}

/**
 * Run one analyser and package the outcome as a `DerivedRecord`. A throwing
 * analyser yields an error row; it never propagates.
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
): Promise<DerivedRecord> {
  const clock = options.clock ?? systemClock;
  const mode = options.mode ?? analyser.mode;
  const hash = paramsHash(params);
  const status = (s: Omit<AnalyserStatus, 'analyserId' | 'mode' | 'paramsHash'>): void =>
    options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: hash, ...s });

  status({ state: 'running' });
  const started = clock.ms();
  const runCtx = withResults(ctx, ctx.results, (current, total) =>
    status({ state: 'running', progress: { current, total } }),
  );
  try {
    const result = await analyser.run(runCtx, params);
    const ms = clock.ms() - started;
    status({ state: 'done', ms });
    return {
      replayId: ctx.replay.id,
      analyserId: analyser.id,
      paramsHash: hash,
      analyserVersion: analyser.version,
      result,
      error: null,
      computedAt: clock.now(),
      ms,
    };
  } catch (err) {
    const ms = clock.ms() - started;
    const error = err instanceof Error ? err.message : String(err);
    status({ state: 'failed', ms, error });
    return {
      replayId: ctx.replay.id,
      analyserId: analyser.id,
      paramsHash: hash,
      analyserVersion: analyser.version,
      result: null,
      error,
      computedAt: clock.now(),
      ms,
    };
  }
}

/**
 * Run every registered analyser of the given modes, unparameterized, in
 * dependency order. Dependencies outside the requested modes are satisfied from
 * `existing` rows when fresh, otherwise computed too (a `background` run that
 * depends on a `ready` result whose row was lost recomputes it). Each analyser's
 * failure is isolated to its own error row; dependents of a failed analyser are
 * skipped with an error row of their own.
 */
export async function runAnalysers(options: RunOptions): Promise<RunOutcome> {
  const { registry, ctx, modes } = options;
  const clock = options.clock ?? systemClock;
  registry.validate();

  const existing = new Map<string, DerivedRecord>();
  for (const row of options.existing ?? []) {
    if (row.replayId === ctx.replay.id && row.paramsHash === NO_PARAMS)
      existing.set(row.analyserId, row);
  }

  const wanted = new Set(modes);
  const targets = registry.list().filter((r) => wanted.has(r.mode));
  const plan: AnalyserRegistration[] = registry.order(targets.map((r) => r.analyser.id));

  const results: Record<string, unknown> = {};
  const failed = new Set<string>();
  const computed: DerivedRecord[] = [];

  for (const reg of plan) {
    const { analyser, mode } = reg;
    const prior = existing.get(analyser.id);
    if (isFresh(prior, analyser)) {
      results[analyser.id] = prior.result;
      options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: NO_PARAMS, state: 'cached' });
      continue;
    }
    options.onStatus?.({ analyserId: analyser.id, mode, paramsHash: NO_PARAMS, state: 'queued' });
    const brokenDep = (analyser.dependsOn ?? []).find((d) => failed.has(d));
    if (brokenDep !== undefined) {
      const error = `dependency '${brokenDep}' failed`;
      failed.add(analyser.id);
      options.onStatus?.({
        analyserId: analyser.id,
        mode,
        paramsHash: NO_PARAMS,
        state: 'failed',
        error,
      });
      computed.push({
        replayId: ctx.replay.id,
        analyserId: analyser.id,
        paramsHash: NO_PARAMS,
        analyserVersion: analyser.version,
        result: null,
        error,
        computedAt: clock.now(),
        ms: 0,
      });
      continue;
    }
    const deps: Record<string, unknown> = {};
    for (const d of analyser.dependsOn ?? []) deps[d] = results[d];
    const row = await runAnalyser(analyser, withResults(ctx, deps), undefined, {
      mode,
      clock,
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    });
    computed.push(row);
    if (row.error === null) results[analyser.id] = row.result;
    else failed.add(analyser.id);
  }
  return { computed, results };
}
