import Dexie, { type Collection, type Table } from 'dexie';
import type { NormalizedReplay, ReplayCollectionName, ReplayStatus } from '../model/records.js';
import { REPLAY_COLLECTIONS } from '../model/records.js';
import type { HeroDb } from './HeroDb.js';
import { WRITE_CHUNK } from './schema.js';

/**
 * Where one store write is. IndexedDB runs read-write transactions over the same tables
 * one at a time, so a write first `waiting`s for its turn (other jobs hold the tables),
 * then is `writing`, with `current` of `total` rows added so far.
 */
export interface StoreWriteProgress {
  readonly state: 'waiting' | 'writing';
  readonly current: number;
  readonly total: number;
}

export type OnStoreWrite = (progress: StoreWriteProgress) => void;

export interface WriteReplayOptions {
  /** Keep the raw `.StormReplay`. Off by default — tie it to the app's privacy setting. */
  readonly file?: { readonly name: string; readonly bytes: Uint8Array };
  /** Status to record with the replay (default: the record's own, `ingesting`). */
  readonly status?: ReplayStatus;
  /** Waiting, then once per chunk of rows written. */
  readonly onProgress?: OnStoreWrite;
}

/** `bulkAdd` in chunks of `WRITE_CHUNK`; `onChunk` gets each chunk's row count. */
export async function bulkAddChunked<T>(
  table: Table<T, unknown>,
  rows: readonly T[],
  onChunk?: (rows: number) => void,
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK) as T[];
    await table.bulkAdd(chunk);
    onChunk?.(chunk.length);
  }
}

/**
 * Run `body` in a read-write transaction over `tables`, reporting `waiting` until the
 * transaction has started and `writing` from then on. IndexedDB has no "started" event;
 * the first request of a transaction completes only once it runs, so `probe` (a cheap
 * read inside the scope) marks the start.
 */
export async function trackedWrite<T>(
  db: HeroDb,
  tables: readonly Table[],
  total: number,
  onProgress: OnStoreWrite | undefined,
  probe: () => Promise<unknown>,
  body: (added: (rows: number) => void) => Promise<T>,
): Promise<T> {
  if (!onProgress) return db.transaction('rw', [...tables], () => body(() => undefined));
  let current = 0;
  onProgress({ state: 'waiting', current, total });
  return db.transaction('rw', [...tables], async () => {
    await probe();
    onProgress({ state: 'writing', current, total });
    return body((rows) => {
      current += rows;
      onProgress({ state: 'writing', current, total });
    });
  });
}

/**
 * The rows of one replay in a table whose primary key starts with `replayId`, as a
 * single primary-key range. Works for keys of any length: `[id, minKey]` sorts before
 * and `[id, maxKey]` after every longer key with the same first element, and the plain
 * key `replayId` (one row per replay) is matched exactly.
 */
export function replayRange<T>(table: Table<T, unknown>, replayId: string): Collection<T, unknown> {
  const primary = table.schema.primKey.src;
  if (primary === 'replayId' || primary === '&replayId') return table.where(':id').equals(replayId);
  return table.where(':id').between([replayId, Dexie.minKey], [replayId, Dexie.maxKey], true, true);
}

/** Delete every row of a replay except the `replays` record itself — one range delete per table. */
export async function deleteReplayRows(db: HeroDb, replayId: string): Promise<void> {
  for (const table of db.replayTables) {
    if (table.name === 'replays') continue;
    if (table.name === 'replayFiles') await db.replayFiles.delete(replayId);
    else await replayRange(table as Table<unknown, unknown>, replayId).delete();
  }
}

/**
 * Write a normalized replay atomically: one read-write transaction that removes any
 * previous rows for the same id (core and analyser tables alike) and inserts the new
 * ones. Re-ingesting a replay therefore always replaces it. A failure anywhere leaves
 * the database as it was.
 */
export async function writeReplay(
  db: HeroDb,
  n: NormalizedReplay,
  options: WriteReplayOptions = {},
): Promise<void> {
  const id = n.replay.id;
  const collections = REPLAY_COLLECTIONS as readonly ReplayCollectionName[];
  const total = collections.reduce((sum, name) => sum + n[name].length, 0);
  await trackedWrite(
    db,
    db.replayTables,
    total,
    options.onProgress,
    () => db.replays.get(id),
    async (added) => {
      await deleteReplayRows(db, id);
      await db.replays.put({
        ...n.replay,
        hasFile: options.file !== undefined,
        status: options.status ?? n.replay.status,
      });
      for (const name of collections) {
        await bulkAddChunked(db.table(name) as Table<unknown, unknown>, n[name], added);
      }
      if (options.file) {
        await db.replayFiles.put({
          replayId: id,
          name: options.file.name,
          bytes: options.file.bytes,
        });
      }
    },
  );
}

export async function setReplayStatus(
  db: HeroDb,
  replayId: string,
  status: ReplayStatus,
): Promise<void> {
  await db.replays.update(replayId, { status });
}

/** Remove a replay and everything that belongs to it. */
export async function deleteReplay(db: HeroDb, replayId: string): Promise<void> {
  await db.transaction('rw', db.replayTables, async () => {
    await deleteReplayRows(db, replayId);
    await db.replays.delete(replayId);
  });
}
