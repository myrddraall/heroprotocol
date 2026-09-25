/**
 * Core Dexie schema. Every per-replay table has a compound primary key that starts with
 * `replayId`, so a replay's rows are one contiguous key range: deleting a replay is one
 * range delete per table (no key enumeration), and reading it is one range scan. The
 * plain `replayId` index is kept for ergonomic `where('replayId')` queries, and compound
 * indexes lead with `replayId` so per-replay filters (by kind, by player, by time) are
 * index walks.
 *
 * Analysers add their own tables under the same rule; `HeroDb.open()` merges them in and
 * bumps the database version whenever the resulting store set differs from what is
 * installed, so there is no hand-maintained version number.
 */
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
  analyserRuns:
    '[replayId+analyserId+paramsHash], replayId, [replayId+analyserId], analyserId, computedAt',
  replayFiles: 'replayId',
  ingestJobs: '++id, replayId, status, startedAt',
  meta: 'key',
};

/** Tables that are not per-replay data. */
export const NON_REPLAY_TABLES: ReadonlySet<string> = new Set(['ingestJobs', 'meta']);

/** Rows per `bulkAdd`; keeps each request comfortably sized without many round trips. */
export const WRITE_CHUNK = 2000;

/** A schema string as a canonical set of specs, for comparing declared vs installed. */
export function normalizeSchema(schema: string): string {
  const specs = schema
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const [primary, ...indexes] = specs;
  return [primary ?? '', ...indexes.sort()].join(',');
}
