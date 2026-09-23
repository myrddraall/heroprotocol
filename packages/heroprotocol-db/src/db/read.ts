import type { Table } from 'dexie';
import { matches } from '../analysers/context.js';
import { statSupportFor } from '../analysers/statSupport.js';
import type { AnalyserContext, StatSupportTable, Where } from '../analysers/types.js';
import type { RecordOf, ReplayCollectionName, ReplayRecord } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';

/** Fields that have a `[replayId+field]` index and so can be narrowed before filtering. */
const INDEXED: Readonly<Partial<Record<ReplayCollectionName, readonly string[]>>> = {
  players: ['slot', 'team'],
  scoreResults: ['slot', 'team'],
  statEvents: ['eventName', 'playerSlot', 'gameloop'],
  units: ['tag', 'unitClass', 'ownerSlot', 'killerSlot'],
  commands: ['playerSlot', 'gameloop'],
  events: ['kind', 'playerSlot', 'gameloop'],
  chat: ['gameloop'],
};

/**
 * Read one replay's rows from a collection, optionally filtered by field equality.
 * Uses a compound index for the first indexable filter field and applies the rest
 * in memory — the same semantics as the in-memory context's `read()`.
 */
export async function readRows<K extends ReplayCollectionName>(
  db: HeroDb,
  collection: K,
  replayId: string,
  where?: Where<K>,
): Promise<RecordOf<K>[]> {
  const table = db.table(collection) as Table<RecordOf<K>, unknown>;
  const indexed = where
    ? INDEXED[collection]?.find((f) => (where as Record<string, unknown>)[f] !== undefined)
    : undefined;
  const rows =
    indexed === undefined
      ? await table.where('replayId').equals(replayId).toArray()
      : await table
          .where(`[replayId+${indexed}]`)
          .equals([replayId, (where as Record<string, unknown>)[indexed] as string | number])
          .toArray();
  return where ? rows.filter((r) => matches(r, where)) : rows;
}

export interface DbContextOptions {
  readonly results?: Readonly<Record<string, unknown>>;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly statSupport?: StatSupportTable;
  readonly onProgress?: (current: number, total: number) => void;
}

/** An `AnalyserContext` whose reads hit the store — what lazy and re-analysis runs use. */
export async function createDbContext(
  db: HeroDb,
  replay: ReplayRecord,
  options: DbContextOptions = {},
): Promise<AnalyserContext> {
  const statSupport =
    options.statSupport ??
    statSupportFor({
      baseBuild: replay.version.baseBuild,
      hasScoreResults: replay.rowCounts.scoreResults > 0,
    });
  return {
    replay,
    results: options.results ?? {},
    services: options.services ?? {},
    statSupport,
    read: (collection, where) => readRows(db, collection, replay.id, where),
    progress(current, total) {
      options.onProgress?.(current, total);
    },
  };
}
