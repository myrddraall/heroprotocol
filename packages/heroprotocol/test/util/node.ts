/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const FIXTURES: string = join(import.meta.dirname, '..', 'fixtures');
export const LOCAL: string = join(FIXTURES, 'local');
export const GOLDEN: string = join(FIXTURES, 'golden');

/** Replays present in the untracked local fixture directory. */
export function localReplays(): string[] {
  if (!existsSync(LOCAL)) return [];
  return readdirSync(LOCAL)
    .filter((f) => /\.(stormreplay|stormr)$/i.test(f))
    .sort();
}

export function readReplay(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(LOCAL, name)));
}

export interface Golden {
  fixture: string;
  build: number;
  header: unknown;
  details: unknown;
  initData: unknown;
  attributes: unknown;
  tracker: GoldenStream;
  message: GoldenStream;
  game: GoldenStream;
}
export interface GoldenStream {
  count: number;
  countsByKind: Record<string, number>;
  numericSum: number;
  lastGameloop: number | null;
  first: unknown[];
  last: unknown[];
}

/** The Python-oracle golden for a fixture replay, or undefined if none is committed. */
export function goldenFor(replayFile: string): Golden | undefined {
  const build = /_(\d+)\.stormreplay$/i.exec(replayFile)?.[1];
  const candidates = readdirSync(GOLDEN).filter((f) => f.endsWith('.json.gz'));
  const match =
    candidates.find((f) => build !== undefined && f.includes(`_${build}.json.gz`)) ??
    candidates.find((f) => replayFile.toLowerCase().startsWith(f.split('_')[0]!.toLowerCase()));
  if (match === undefined) return undefined;
  return JSON.parse(gunzipSync(readFileSync(join(GOLDEN, match))).toString('utf8')) as Golden;
}

/** Sum of every integer field, matching the Python oracle's checksum (booleans excluded). */
export function numericSum(value: unknown): number {
  if (typeof value === 'number') return Number.isInteger(value) ? value : 0;
  if (Array.isArray(value)) return value.reduce<number>((a, v) => a + numericSum(v), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>((a, v) => a + numericSum(v), 0);
  }
  return 0;
}

export function readProtocolSource(build: number): string {
  return readFileSync(join(FIXTURES, 'protocols', `protocol${build}.py`), 'utf8');
}
