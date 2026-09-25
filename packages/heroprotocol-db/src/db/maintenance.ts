import type { AnalyserRegistry } from '../analysers/registry.js';
import { isFresh, runAnalysers, type AnalyserOutput } from '../analysers/runner.js';
import type { AnalyserStatus, RunClock } from '../analysers/types.js';
import { NO_PARAMS } from '../analysers/paramsHash.js';
import type { ReplayRecord } from '../model/records.js';
import { NORMALIZE_VERSION } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';
import { createDbContext } from './read.js';
import { deleteRun, loadReplayRuns, saveAnalyserOutput } from './runs.js';
import { deleteReplay, setReplayStatus } from './write.js';

/** Replays normalized by an older normalizer than the one now running. */
export async function staleReplays(db: HeroDb): Promise<ReplayRecord[]> {
  return (await db.replays.toArray()).filter((r) => r.normalizeVersion !== NORMALIZE_VERSION);
}

/** Replays newest-first by ingest time. */
export async function listReplays(db: HeroDb): Promise<ReplayRecord[]> {
  return db.replays.orderBy('ingestedAt').reverse().toArray();
}

export interface PruneOptions {
  /** How many most-recently-ingested replays to keep. */
  readonly keep: number;
}

/** Enforce "the last X": delete every replay beyond the newest `keep`. Returns the ids removed. */
export async function pruneReplays(db: HeroDb, options: PruneOptions): Promise<string[]> {
  const all = await listReplays(db);
  const doomed = all.slice(Math.max(0, options.keep));
  for (const r of doomed) await deleteReplay(db, r.id);
  return doomed.map((r) => r.id);
}

export interface ReanalyseOptions {
  readonly registry: AnalyserRegistry;
  /** One replay, or every replay when omitted. */
  readonly replayId?: string;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly onStatus?: (replayId: string, status: AnalyserStatus) => void;
  readonly clock?: RunClock;
}

/**
 * Bring stored analyser output up to date from the persisted model: `ready` and
 * `background` analysers whose runs are missing, stale or errored are recomputed and
 * their tables rewritten; stale `lazy` runs are dropped with their rows so they
 * recompute on next request. No raw file is needed — this is why the model is stored.
 */
export async function reanalyse(db: HeroDb, options: ReanalyseOptions): Promise<AnalyserOutput[]> {
  const replays =
    options.replayId !== undefined
      ? [await db.replays.get(options.replayId)]
      : await db.replays.toArray();
  const computed: AnalyserOutput[] = [];
  for (const replay of replays) {
    if (!replay) continue;
    const existing = await loadReplayRuns(db, replay.id);
    const ctx = await createDbContext(
      db,
      replay,
      options.services ? { services: options.services } : {},
    );
    const outcome = await runAnalysers({
      registry: options.registry,
      ctx,
      modes: ['ready', 'background'],
      existing,
      onComputed: (output) =>
        saveAnalyserOutput(db, options.registry.get(output.run.analyserId)!.analyser, output),
      ...(options.onStatus
        ? { onStatus: (s: AnalyserStatus) => options.onStatus!(replay.id, s) }
        : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
    computed.push(...outcome.computed);
    for (const run of existing) {
      const reg = options.registry.get(run.analyserId);
      if (!reg || reg.mode !== 'lazy' || run.paramsHash === NO_PARAMS) continue;
      const fresh = isFresh(run, reg.analyser);
      if (!fresh) await deleteRun(db, reg.analyser, run);
    }
    if (replay.status === 'ready' || replay.status === 'complete') {
      const done = new Set([
        ...outcome.reused,
        ...outcome.computed.filter((o) => o.run.error === null).map((o) => o.run.analyserId),
      ]);
      const allDone = options.registry.list('background').every((r) => done.has(r.analyser.id));
      await setReplayStatus(db, replay.id, allDone ? 'complete' : 'ready');
    }
  }
  return computed;
}
