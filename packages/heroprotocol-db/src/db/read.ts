import type { Table } from 'dexie';
import { matches } from '../analysers/context.js';
import { statSupportFor } from '../analysers/statSupport.js';
import type { AnalyserContext, StatSupportTable, Where } from '../analysers/types.js';
import type { RecordOf, ReplayCollectionName, ReplayRecord } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';
import { replayRange } from './write.js';

/**
 * Read one replay's rows from a core collection, optionally filtered by field equality:
 * one primary-key range scan, then the filter in memory — the same semantics as the
 * in-memory context's `read()`.
 */
export async function readRows<K extends ReplayCollectionName>(
  db: HeroDb,
  collection: K,
  replayId: string,
  where?: Where<RecordOf<K>>,
): Promise<RecordOf<K>[]> {
  const rows = await replayRange(
    db.table(collection) as Table<RecordOf<K>, unknown>,
    replayId,
  ).toArray();
  return where ? rows.filter((r) => matches(r, where)) : rows;
}

/** Read one replay's rows from an analyser table (its primary-key range), optionally filtered. */
export async function readTableRows<T extends object = Record<string, unknown>>(
  db: HeroDb,
  table: string,
  replayId: string,
  where?: Where<T>,
): Promise<T[]> {
  if (!db.tables.some((t) => t.name === table))
    throw new Error(`table '${table}' is not in the database`);
  const rows = (await replayRange(db.table(table) as Table<T, unknown>, replayId).toArray()) as T[];
  return where ? rows.filter((r) => matches(r, where)) : rows;
}

export interface DbContextOptions {
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
    services: options.services ?? {},
    statSupport,
    read: (collection, where) => readRows(db, collection, replay.id, where),
    readTable: (table, where) => readTableRows(db, table, replay.id, where),
    progress(current, total) {
      options.onProgress?.(current, total);
    },
  };
}
