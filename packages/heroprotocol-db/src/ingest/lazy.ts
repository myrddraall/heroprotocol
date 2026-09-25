import { NO_PARAMS, paramsHash } from '../analysers/paramsHash.js';
import type { AnalyserRegistry } from '../analysers/registry.js';
import { isFresh, runAnalyser, systemClock, type AnalyserOutput } from '../analysers/runner.js';
import type { AnalyserStatus, RunClock } from '../analysers/types.js';
import type { HeroDb } from '../db/HeroDb.js';
import { createDbContext } from '../db/read.js';
import { loadRun, loadRunRows, saveAnalyserOutput } from '../db/runs.js';

export interface AnalyseOptions {
  readonly registry: AnalyserRegistry;
  readonly params?: unknown;
  /** Recompute even when a fresh run exists. */
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
 * Run one analyser on demand from the persisted model — the lazy flow. A fresh run for
 * the same (replay, analyser, params) is served from its tables; otherwise the analyser
 * runs over a store-backed context, dependencies resolved the same way recursively, and
 * its rows are saved (respecting the analyser's cache bound). Resolves with the run
 * record and the rows.
 */
export async function analyse(
  db: HeroDb,
  replayId: string,
  analyserId: string,
  options: AnalyseOptions,
): Promise<AnalyserOutput> {
  const reg = options.registry.get(analyserId);
  if (!reg) throw new Error(`analyser '${analyserId}' is not registered`);
  const { analyser, mode } = reg;
  const hash = paramsHash(options.params);
  const cached = await loadRun(db, replayId, analyserId, hash);
  if (!options.force && isFresh(cached, analyser)) {
    options.onStatus?.({ analyserId, mode, paramsHash: hash, state: 'cached' });
    return { run: cached, rows: await loadRunRows(db, analyser, replayId, hash) };
  }
  const replay = await db.replays.get(replayId);
  if (!replay) throw new ReplayNotFoundError(replayId);

  for (const dep of analyser.dependsOn ?? []) {
    const depOutput = await analyse(db, replayId, dep, {
      ...options,
      params: undefined,
      force: false,
    });
    if (depOutput.run.error !== null) {
      const error = `dependency '${dep}' failed`;
      const failed: AnalyserOutput = {
        run: {
          replayId,
          analyserId,
          paramsHash: hash,
          analyserVersion: analyser.version,
          error,
          computedAt: (options.clock ?? systemClock).now(),
          ms: 0,
        },
        rows: {},
      };
      options.onStatus?.({ analyserId, mode, paramsHash: hash, state: 'failed', error });
      await saveAnalyserOutput(db, analyser, failed);
      return failed;
    }
  }

  const ctx = await createDbContext(
    db,
    replay,
    options.services ? { services: options.services } : {},
  );
  const output = await runAnalyser(analyser, ctx, options.params, {
    mode,
    ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });
  await saveAnalyserOutput(db, analyser, output);
  return output;
}

export { NO_PARAMS };
