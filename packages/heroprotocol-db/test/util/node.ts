/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NOISY_GAME_EVENTS, openReplay, type ParsedReplay } from '@myrddraall/heroprotocol';
import type { NormalizedReplay, ReplayCollectionName } from '../../src/model/records.js';
import { REPLAY_COLLECTIONS } from '../../src/model/records.js';
import { normalizeReplay } from '../../src/normalize/normalizeReplay.js';

/** The parser package's untracked replay directory (`pnpm run fetch.fixtures`). */
export const LOCAL: string = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'heroprotocol',
  'test',
  'fixtures',
  'local',
);
export const GOLDEN: string = join(import.meta.dirname, '..', 'fixtures', 'golden');

/** A fixed `now` so normalized output is reproducible. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export function localReplays(): string[] {
  if (!existsSync(LOCAL)) return [];
  return readdirSync(LOCAL)
    .filter((f) => /\.(stormreplay|stormr)$/i.test(f))
    .sort();
}

export async function parseLocal(name: string): Promise<ParsedReplay> {
  return openReplay(new Uint8Array(readFileSync(join(LOCAL, name))), {
    dropGameEvents: NOISY_GAME_EVENTS,
  });
}

export async function normalizeLocal(name: string): Promise<NormalizedReplay> {
  return normalizeReplay(await parseLocal(name), { now: FIXED_NOW });
}

/**
 * The committed golden for a fixture: the replay, players and score results in
 * full, and for the large collections the row count, a checksum over every
 * numeric field, and the first and last rows.
 */
export interface Golden {
  fixture: string;
  build: number;
  replay: unknown;
  players: unknown[];
  scoreResults: unknown[];
  collections: Record<string, GoldenCollection>;
}
export interface GoldenCollection {
  count: number;
  numericSum: number;
  first: unknown[];
  last: unknown[];
}

export function goldenName(replayFile: string): string {
  return replayFile.replace(/\.(stormreplay|stormr)$/i, '').toLowerCase() + '.normalized.json.gz';
}

export function goldenFor(replayFile: string): Golden | undefined {
  const file = join(GOLDEN, goldenName(replayFile));
  if (!existsSync(file)) return undefined;
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Golden;
}

export function numericSum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) return value.reduce<number>((a, v) => a + numericSum(v), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (a, v) => a + numericSum(v),
      0,
    );
  }
  return 0;
}

export function makeGolden(fixture: string, n: NormalizedReplay): Golden {
  const collections: Record<string, GoldenCollection> = {};
  for (const name of REPLAY_COLLECTIONS as readonly ReplayCollectionName[]) {
    if (name === 'players' || name === 'scoreResults') continue;
    const rows = n[name] as readonly unknown[];
    collections[name] = {
      count: rows.length,
      numericSum: Math.round(numericSum(rows) * 1000) / 1000,
      first: rows.slice(0, 3),
      last: rows.slice(-2),
    };
  }
  return {
    fixture,
    build: n.replay.version.baseBuild,
    replay: n.replay,
    players: [...n.players],
    scoreResults: [...n.scoreResults],
    collections,
  };
}
