/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NOISY_GAME_EVENTS, openReplay } from '@myrddraall/heroprotocol';
import { normalizeReplay, type NormalizedReplay } from '@myrddraall/heroprotocol-db';

/** The parser package's untracked replay directory (`pnpm run fetch.fixtures`). */
export const LOCAL: string = join(
  import.meta.dirname,
  '..',
  '..',
  'heroprotocol',
  'test',
  'fixtures',
  'local',
);
export const GOLDEN: string = join(import.meta.dirname, 'fixtures', 'golden');
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export function localReplays(): string[] {
  if (!existsSync(LOCAL)) return [];
  return readdirSync(LOCAL)
    .filter((f) => /\.(stormreplay|stormr)$/i.test(f))
    .sort();
}

export function readLocal(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(LOCAL, name)));
}

export async function normalizeLocal(name: string): Promise<NormalizedReplay> {
  return normalizeReplay(await openReplay(readLocal(name), { dropGameEvents: NOISY_GAME_EVENTS }), {
    now: FIXED_NOW,
  });
}

export function goldenName(replayFile: string): string {
  return replayFile.replace(/\.(stormreplay|stormr)$/i, '').toLowerCase() + '.analysis.json.gz';
}

/** Every built-in's result for a fixture, keyed by analyser id (lazy ones under their params hash). */
export type AnalysisGolden = Record<string, unknown>;

export function goldenFor(replayFile: string): AnalysisGolden | undefined {
  const file = join(GOLDEN, goldenName(replayFile));
  if (!existsSync(file)) return undefined;
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as AnalysisGolden;
}

/** Round every number so float noise across engines never trips a golden. */
export function stable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v,
    ),
  ) as T;
}
