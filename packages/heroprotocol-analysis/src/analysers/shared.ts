import type {
  AnalyserContext,
  PlayerRecord,
  ScoreResultRecord,
  StatEventRecord,
  Team,
} from '@myrddraall/heroprotocol-db';

/** Analyser ids are namespaced under the package's scope. */
export const NS = '@myrddraall/';

/** Human players and AI, in slot order — observers are not part of the game. */
export async function participants(ctx: AnalyserContext): Promise<PlayerRecord[]> {
  return (await ctx.read('players'))
    .filter((p) => p.kind !== 'observer')
    .sort((a, b) => a.slot - b.slot);
}

export function bySlot<T extends { readonly slot: number }>(rows: readonly T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.slot, r]));
}

export async function statEvents(
  ctx: AnalyserContext,
  eventName: string,
): Promise<StatEventRecord[]> {
  return [...(await ctx.read('statEvents', { eventName }))].sort((a, b) => a.gameloop - b.gameloop);
}

export function int(e: StatEventRecord, key: string): number | null {
  const v = e.values[key];
  return typeof v === 'number' ? v : null;
}

export function str(e: StatEventRecord, key: string): string | null {
  const v = e.values[key];
  return typeof v === 'string' ? v : null;
}

/** A repeated key (`lists`) or a single value, always as an array. */
export function all(e: StatEventRecord, key: string): (number | string)[] {
  const list = e.lists?.[key];
  if (list) return [...list];
  const v = e.values[key];
  return v === undefined ? [] : [v];
}

export function scoreOf(
  scores: readonly ScoreResultRecord[],
  slot: number,
): ScoreResultRecord | undefined {
  return scores.find((s) => s.slot === slot);
}

export function sumBy<T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number {
  let total = 0;
  for (const r of rows) total += pick(r) ?? 0;
  return total;
}

export const TEAMS: readonly Team[] = [0, 1];

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

/** Number rows 0..n-1 so `[replayId+seq]` keys them in order. */
export function withSeq<T extends object>(rows: readonly T[]): (T & { seq: number })[] {
  return rows.map((row, seq) => ({ ...row, seq }));
}

/** Player identity fields that per-player rows repeat, so consumers never join. */
export interface PlayerRef {
  readonly slot: number;
  readonly name: string;
  readonly hero: string;
  readonly heroId: string;
  readonly team: Team | null;
  readonly won: boolean | null;
}

export function ref(p: PlayerRecord): PlayerRef {
  return { slot: p.slot, name: p.name, hero: p.hero, heroId: p.heroId, team: p.team, won: p.won };
}
