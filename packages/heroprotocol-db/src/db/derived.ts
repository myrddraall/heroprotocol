import type { AnalyserCacheOptions } from '../analysers/types.js';
import type { DerivedRecord } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';

/**
 * Persist an analyser result. With a `maxEntries` bound, the oldest rows of the same
 * (replay, analyser) beyond the bound are evicted — this is how a parameterized
 * lazy analyser with an unbounded parameter space stays cached but finite.
 */
export async function saveDerived(
  db: HeroDb,
  row: DerivedRecord,
  cache?: AnalyserCacheOptions,
): Promise<void> {
  await db.transaction('rw', db.derived, async () => {
    await db.derived.put(row);
    const max = cache?.maxEntries;
    if (max === undefined || max < 1) return;
    const rows = await db.derived
      .where('[replayId+analyserId]')
      .equals([row.replayId, row.analyserId])
      .toArray();
    if (rows.length <= max) return;
    rows.sort((a, b) => (a.computedAt < b.computedAt ? -1 : a.computedAt > b.computedAt ? 1 : 0));
    const evict = rows.filter((r) => r.paramsHash !== row.paramsHash).slice(0, rows.length - max);
    await db.derived.bulkDelete(evict.map((r) => [r.replayId, r.analyserId, r.paramsHash]));
  });
}

export function loadDerived(
  db: HeroDb,
  replayId: string,
  analyserId: string,
  paramsHash: string,
): Promise<DerivedRecord | undefined> {
  return db.derived.get([replayId, analyserId, paramsHash]);
}

export function loadReplayDerived(db: HeroDb, replayId: string): Promise<DerivedRecord[]> {
  return db.derived.where('replayId').equals(replayId).toArray();
}
