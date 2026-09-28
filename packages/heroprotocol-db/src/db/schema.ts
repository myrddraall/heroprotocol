/**
 * Core Dexie schema. Every per-replay table has a compound primary key that starts with
 * `replayId`, so a replay's rows are one contiguous key range: deleting a replay is one
 * range delete per table (no key enumeration), and reading it is one range scan.
 * `where('replayId')` still works: Dexie serves it from the primary key's first part.
 *
 * The per-replay tables carry no secondary indexes. Every read is per replay, so a range
 * scan plus an in-memory filter is cheap, while each index is one more write per row:
 * in a Chromium benchmark, dropping them took writing a ~30k-row replay from about 28 s
 * to 5–9 s.
 * The only one kept is `players.toon.handle`, for finding a player across replays.
 *
 * Analysers add their own tables under the same rule; `HeroDb.open()` merges them in and
 * bumps the database version whenever the resulting store set differs from what is
 * installed, so there is no hand-maintained version number.
 */
export const STORES: Readonly<Record<string, string>> = {
  replays: 'id, playedAt, ingestedAt, map, mode, status',
  players: '[replayId+slot], toon.handle',
  scoreResults: '[replayId+slot]',
  statEvents: '[replayId+seq]',
  units: '[replayId+tag]',
  commands: '[replayId+seq]',
  events: '[replayId+seq]',
  chat: '[replayId+seq]',
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
