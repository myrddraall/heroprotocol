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
  /** Status to record with the replay (default: the record's own, `ingesting`). */
  readonly status?: ReplayStatus;
  /** Waiting, then once per chunk of rows written. */
  readonly onProgress?: OnStoreWrite;
  /** A background write (an import's), giving way to priority work (`exclusiveWrite`). */
  readonly background?: boolean;
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

/** The Web Locks API, where the environment has it (browsers, their workers, Node). */
interface WriteLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
  request<T>(
    name: string,
    options: { readonly mode: 'shared' | 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const webLocks = (): WriteLocks | undefined =>
  (globalThis as { navigator?: { locks?: WriteLocks } }).navigator?.locks;

/** A database's locks' names: its writes' turn, background writes' queue, priority work. */
const lockName = (dbName: string, lock: 'write' | 'background' | 'priority'): string =>
  `heroprotocol-db:${dbName}:${lock}`;

/**
 * Runs `write` once no other write of this database's is running, in any worker or tab: one
 * at a time, under a Web Lock. IndexedDB starts a transaction only after every earlier one
 * over any of its tables, a read included, so with several imports creating their write
 * transactions as they like, a read made during a batch waited behind all of them (a minute
 * on ten replays). Taking turns here, before a transaction exists, leaves IndexedDB at most
 * one write ahead of a read.
 *
 * A `background` write (an import's, a reanalysis') gives way: background writes queue among
 * themselves first, and the one at the front waits until no priority work runs
 * (`withPriority`) before taking its turn, so an open replay's own writes (its analysers')
 * and reads wait for one background write at most. Without Web Locks, `write` runs at once.
 * Never call it inside a transaction (waiting would leave it idle, and IndexedDB commits an
 * idle one).
 */
export async function exclusiveWrite<T>(
  db: HeroDb,
  write: () => Promise<T>,
  background = false,
): Promise<T> {
  const locks = webLocks();
  if (!locks) return write();
  const turn = () => locks.request(lockName(db.name, 'write'), write);
  if (!background) return turn();
  return locks.request(lockName(db.name, 'background'), async () => {
    // granted once every priority holder has let go
    await locks.request(lockName(db.name, 'priority'), async () => undefined);
    return turn();
  });
}

/**
 * Runs `work` as priority work on the database `dbName` (an open replay's reads and analysers):
 * while it runs, background writes take no new turn (`exclusiveWrite`). Any number run at
 * once. Without Web Locks, `work` runs at once.
 */
export async function withPriority<T>(dbName: string, work: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  return locks ? locks.request(lockName(dbName, 'priority'), { mode: 'shared' }, work) : work();
}

/**
 * Run `body` in a read-write transaction over `tables`, its turn first (`exclusiveWrite`),
 * reporting `waiting` until the transaction has started and `writing` from then on. IndexedDB has no "started" event;
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
  background = false,
): Promise<T> {
  if (!onProgress)
    return exclusiveWrite(
      db,
      () => db.transaction('rw', [...tables], async () => await body(() => undefined)),
      background,
    );
  let current = 0;
  onProgress({ state: 'waiting', current, total });
  return exclusiveWrite(
    db,
    () =>
      db.transaction('rw', [...tables], async () => {
        await probe();
        onProgress({ state: 'writing', current, total });
        return body((rows) => {
          current += rows;
          onProgress({ state: 'writing', current, total });
        });
      }),
    background,
  );
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
    await replayRange(table as Table<unknown, unknown>, replayId).delete();
  }
}

/**
 * Write a normalized replay, replacing any previous rows for the same id (core and analyser
 * tables alike), so re-ingesting a replay always replaces it. Three steps, so the long one
 * never holds `replays`, the table every replay list reads: IndexedDB queues a read behind
 * the read-write transactions over its tables, and one replay's rows take a while to write.
 *
 * 1. A short write records the replay as `ingesting`, which no list shows.
 * 2. Its rows replace the previous ones.
 * 3. A short write records it with its status.
 *
 * In the foreground, step 2 is one transaction: a failure rolls the rows back and puts the
 * previous `replays` record back (or removes the new one), so the database is as it was.
 *
 * A `background` write (an import's) gives way to priority work between every chunk of rows
 * (`exclusiveWrite`): step 2 is a turn to clear the previous rows, then a turn and a short
 * transaction per `WRITE_CHUNK` rows, so an open replay waits for one chunk at most, not for a
 * whole replay's rows. A failure part-way removes the replay, its record and every row written
 * (the previous rows are gone by then): it is imported again from its file.
 */
export async function writeReplay(
  db: HeroDb,
  n: NormalizedReplay,
  options: WriteReplayOptions = {},
): Promise<void> {
  const id = n.replay.id;
  const collections = REPLAY_COLLECTIONS as readonly ReplayCollectionName[];
  const total = collections.reduce((sum, name) => sum + n[name].length, 0);
  const rowTables = db.replayRowTables;
  const background = options.background === true;
  const previous = await exclusiveWrite(
    db,
    () =>
      db.transaction('rw', db.replays, async () => {
        const old = await db.replays.get(id);
        await db.replays.put({ ...n.replay, status: 'ingesting' });
        return old;
      }),
    background,
  );
  if (background) {
    try {
      await writeRowsInTurns(db, n, options.onProgress);
    } catch (err) {
      await deleteReplay(db, id, true);
      throw err;
    }
  } else {
    try {
      await trackedWrite(
        db,
        rowTables,
        total,
        options.onProgress,
        () => db.players.limit(1).first(),
        async (added) => {
          await deleteReplayRows(db, id);
          for (const name of collections) {
            await bulkAddChunked(db.table(name) as Table<unknown, unknown>, n[name], added);
          }
        },
      );
    } catch (err) {
      await (previous ? db.replays.put(previous) : db.replays.delete(id));
      throw err;
    }
  }
  await db.replays.put({ ...n.replay, status: options.status ?? n.replay.status });
}

/**
 * Step 2 of a background `writeReplay`: the previous rows cleared in one turn, then each
 * `WRITE_CHUNK` rows in a turn and a transaction of their own, reporting `waiting` until the
 * first turn and `writing` after each chunk.
 */
async function writeRowsInTurns(
  db: HeroDb,
  n: NormalizedReplay,
  onProgress: OnStoreWrite | undefined,
): Promise<void> {
  const id = n.replay.id;
  const collections = REPLAY_COLLECTIONS as readonly ReplayCollectionName[];
  const total = collections.reduce((sum, name) => sum + n[name].length, 0);
  let current = 0;
  onProgress?.({ state: 'waiting', current, total });
  await exclusiveWrite(
    db,
    () => db.transaction('rw', db.replayRowTables, () => deleteReplayRows(db, id)),
    true,
  );
  onProgress?.({ state: 'writing', current, total });
  for (const name of collections) {
    const table = db.table(name) as Table<unknown, unknown>;
    const rows = n[name] as readonly unknown[];
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      await exclusiveWrite(db, () => db.transaction('rw', table, () => table.bulkAdd(chunk)), true);
      current += chunk.length;
      onProgress?.({ state: 'writing', current, total });
    }
  }
}

export async function setReplayStatus(
  db: HeroDb,
  replayId: string,
  status: ReplayStatus,
): Promise<void> {
  await db.replays.update(replayId, { status });
}

/** Remove a replay and everything that belongs to it (`background`: see `exclusiveWrite`). */
export async function deleteReplay(
  db: HeroDb,
  replayId: string,
  background = false,
): Promise<void> {
  await exclusiveWrite(
    db,
    () =>
      db.transaction('rw', db.replayTables, async () => {
        await deleteReplayRows(db, replayId);
        await db.replays.delete(replayId);
      }),
    background,
  );
}
