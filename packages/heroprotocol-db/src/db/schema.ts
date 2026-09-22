/**
 * Dexie schema. Every per-replay table has a compound primary key that starts with
 * `replayId`, so a replay's rows are one contiguous key range: deleting a replay is
 * one range delete per table (no key enumeration), and reading it is one range scan.
 * The plain `replayId` index is kept for ergonomic `where('replayId')` queries, and
 * compound indexes lead with `replayId` so per-replay filters (by kind, by player,
 * by time) are index walks.
 *
 * Changing this means a new `version(n)` in HeroDb, never an edit in place.
 */
export const DB_VERSION = 1;

export const STORES: Readonly<Record<string, string>> = {
  replays: 'id, playedAt, ingestedAt, map, mode, status',
  players: '[replayId+slot], replayId, [replayId+team], toon.handle',
  scoreResults: '[replayId+slot], replayId, [replayId+team]',
  statEvents:
    '[replayId+seq], replayId, [replayId+eventName], [replayId+eventName+gameloop], [replayId+playerSlot], [replayId+gameloop]',
  units:
    '[replayId+tag], replayId, [replayId+unitClass], [replayId+unitClass+diedAtLoop], [replayId+ownerSlot], [replayId+killerSlot]',
  commands:
    '[replayId+seq], replayId, [replayId+playerSlot], [replayId+playerSlot+gameloop], [replayId+gameloop]',
  events:
    '[replayId+seq], replayId, [replayId+kind], [replayId+kind+gameloop], [replayId+playerSlot], [replayId+gameloop]',
  chat: '[replayId+seq], replayId, [replayId+gameloop]',
  derived:
    '[replayId+analyserId+paramsHash], replayId, [replayId+analyserId], analyserId, computedAt',
  replayFiles: 'replayId',
  ingestJobs: '++id, replayId, status, startedAt',
  meta: 'key',
};

/** Rows per `bulkAdd`; keeps each request comfortably sized without many round trips. */
export const WRITE_CHUNK = 2000;
