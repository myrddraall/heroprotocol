import type { Table } from 'dexie';
import { NO_PARAMS } from '../analysers/paramsHash.js';
import type { AnalyserOutput } from '../analysers/runner.js';
import type { AnalyserRow, AnyAnalyser } from '../analysers/types.js';
import type { AnalyserRunRecord } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';
import { keyedByParams } from '../analysers/runner.js';
import { bulkAddChunked, replayRange } from './write.js';

/** The tables a set of runs' rows live in. */
function tablesOf(db: HeroDb, analyser: AnyAnalyser): Table<AnalyserRow, unknown>[] {
  return Object.keys(analyser.tables).map((name) => db.table(name) as Table<AnalyserRow, unknown>);
}

/**
 * Delete one run's rows. A table whose primary key includes `paramsHash` keeps one row set
 * per parameterization, so only that set goes; any other table holds one set per replay,
 * so the whole replay range goes (a run with params simply replaces it).
 */
async function deleteRunRows(
  db: HeroDb,
  analyser: AnyAnalyser,
  replayId: string,
  paramsHash: string,
): Promise<void> {
  for (const table of tablesOf(db, analyser)) {
    const range = replayRange(table, replayId);
    const perParams = keyedByParams(table.schema.primKey.src);
    if (perParams)
      await range.filter((r) => (r as { paramsHash?: string }).paramsHash === paramsHash).delete();
    else await range.delete();
  }
}

/**
 * Persist an analyser's output atomically: its previous rows for this replay (and
 * params) are replaced by the new ones, and the run is recorded. With a `maxEntries`
 * cache bound, the oldest other parameter sets of the same analyser and replay are
 * evicted beyond the bound — rows and run record together.
 */
export async function saveAnalyserOutput(
  db: HeroDb,
  analyser: AnyAnalyser,
  output: AnalyserOutput,
): Promise<void> {
  const { run, rows } = output;
  const tables = tablesOf(db, analyser);
  await db.transaction('rw', [db.analyserRuns, ...tables], async () => {
    await deleteRunRows(db, analyser, run.replayId, run.paramsHash);
    for (const [name, list] of Object.entries(rows)) {
      await bulkAddChunked(db.table(name) as Table<AnalyserRow, unknown>, list);
    }
    await db.analyserRuns.put(run);

    const max = analyser.cache?.maxEntries;
    if (max === undefined || max < 1 || run.paramsHash === NO_PARAMS) return;
    const runs = await db.analyserRuns
      .where('[replayId+analyserId]')
      .equals([run.replayId, run.analyserId])
      .toArray();
    const parameterized = runs.filter((r) => r.paramsHash !== NO_PARAMS);
    if (parameterized.length <= max) return;
    parameterized.sort((a, b) =>
      a.computedAt < b.computedAt ? -1 : a.computedAt > b.computedAt ? 1 : 0,
    );
    for (const old of parameterized
      .filter((r) => r.paramsHash !== run.paramsHash)
      .slice(0, parameterized.length - max)) {
      await deleteRun(db, analyser, old);
    }
  });
}

/** Remove a run and its rows. */
export async function deleteRun(
  db: HeroDb,
  analyser: AnyAnalyser,
  run: AnalyserRunRecord,
): Promise<void> {
  await deleteRunRows(db, analyser, run.replayId, run.paramsHash);
  await db.analyserRuns.delete([run.replayId, run.analyserId, run.paramsHash]);
}

export function loadRun(
  db: HeroDb,
  replayId: string,
  analyserId: string,
  paramsHash: string,
): Promise<AnalyserRunRecord | undefined> {
  return db.analyserRuns.get([replayId, analyserId, paramsHash]);
}

export function loadReplayRuns(db: HeroDb, replayId: string): Promise<AnalyserRunRecord[]> {
  return db.analyserRuns.where('replayId').equals(replayId).toArray();
}

/** An analyser's rows for one replay (and params), by table — what a cached lazy run hands back. */
export async function loadRunRows(
  db: HeroDb,
  analyser: AnyAnalyser,
  replayId: string,
  paramsHash: string,
): Promise<Record<string, AnalyserRow[]>> {
  const out: Record<string, AnalyserRow[]> = {};
  for (const table of tablesOf(db, analyser)) {
    const rows = await replayRange(table, replayId).toArray();
    out[table.name] = keyedByParams(table.schema.primKey.src)
      ? rows.filter((r) => (r as { paramsHash?: string }).paramsHash === paramsHash)
      : rows;
  }
  return out;
}
