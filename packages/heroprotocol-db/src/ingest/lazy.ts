import { NO_PARAMS, paramsHash } from '../analysers/paramsHash.js';
import type { AnalyserRegistry } from '../analysers/registry.js';
import { isFresh, runAnalyser, systemClock } from '../analysers/runner.js';
import type { AnalyserStatus, RunClock } from '../analysers/types.js';
import { loadDerived, saveDerived } from '../db/derived.js';
import type { HeroDb } from '../db/HeroDb.js';
import { createDbContext } from '../db/read.js';
import type { DerivedRecord } from '../model/records.js';

export interface AnalyseOptions {
  readonly registry: AnalyserRegistry;
  readonly params?: unknown;
  /** Recompute even when a fresh row exists. */
  readonly force?: boolean;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly onStatus?: (status: AnalyserStatus) => void;
  readonly clock?: RunClock;
}

export class ReplayNotFoundError extends Error {
  constructor(replayId: string) {
    super(`replay '${replayId}' is not in the database`);
    this.name = 'ReplayNotFoundError';
  }
}

/**
 * Run one analyser on demand from the persisted model — the lazy flow. A fresh row
 * for the same (replay, analyser, params) is served from `derived`; otherwise the
 * analyser runs over a store-backed context, dependencies resolved the same way
 * recursively, and the result is saved (respecting the analyser's cache bound).
 */
export async function analyse(
  db: HeroDb,
  replayId: string,
  analyserId: string,
  options: AnalyseOptions,
): Promise<DerivedRecord> {
  const reg = options.registry.get(analyserId);
  if (!reg) throw new Error(`analyser '${analyserId}' is not registered`);
  const { analyser, mode } = reg;
  const hash = paramsHash(options.params);
  const cached = await loadDerived(db, replayId, analyserId, hash);
  if (!options.force && isFresh(cached, analyser)) {
    options.onStatus?.({ analyserId, mode, paramsHash: hash, state: 'cached' });
    return cached;
  }
  const replay = await db.replays.get(replayId);
  if (!replay) throw new ReplayNotFoundError(replayId);

  const results: Record<string, unknown> = {};
  for (const dep of analyser.dependsOn ?? []) {
    const row = await analyse(db, replayId, dep, { ...options, params: undefined, force: false });
    if (row.error !== null) {
      const error = `dependency '${dep}' failed`;
      const failed: DerivedRecord = {
        replayId,
        analyserId,
        paramsHash: hash,
        analyserVersion: analyser.version,
        result: null,
        error,
        computedAt: (options.clock ?? systemClock).now(),
        ms: 0,
      };
      options.onStatus?.({ analyserId, mode, paramsHash: hash, state: 'failed', error });
      await saveDerived(db, failed, analyser.cache);
      return failed;
    }
    results[dep] = row.result;
  }

  const ctx = await createDbContext(db, replay, {
    results,
    ...(options.services ? { services: options.services } : {}),
  });
  const row = await runAnalyser(analyser, ctx, options.params, {
    mode,
    ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });
  await saveDerived(db, row, hash === NO_PARAMS ? undefined : analyser.cache);
  return row;
}
