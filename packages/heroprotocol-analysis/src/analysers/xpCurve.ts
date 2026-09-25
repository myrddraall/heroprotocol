import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { int, NS, participants, statEvents, TEAMS } from './shared.js';

export interface XpPointRow {
  readonly team: Team;
  /** Position within the team's curve. */
  readonly seq: number;
  readonly seconds: number;
  readonly previousSeconds: number;
  readonly teamLevel: number | null;
  readonly minionXP: number;
  readonly creepXP: number;
  readonly structureXP: number;
  readonly heroXP: number;
  readonly trickleXP: number;
  /** The five sources summed. */
  readonly total: number;
  /** Running total of `total` up to and including this point. */
  readonly cumulative: number;
}

export type XpCurveTables = {
  readonly xpPoints: XpPointRow[];
};

type XpSource = 'MinionXP' | 'CreepXP' | 'StructureXP' | 'HeroXP' | 'TrickleXP';

/**
 * Per-team XP by source over time: the periodic breakdowns, closed by the end-of-game
 * breakdown. The 2018 XPAnalyser used one player's end-of-game breakdown as the team's
 * final point; here the team's players are summed.
 */
export const xpCurve: Analyser<XpCurveTables> = {
  id: `${NS}xp-curve`,
  version: 2,
  tables: { xpPoints: '[replayId+team+seq], replayId, [replayId+team], seconds' },
  inputs: ['players', 'statEvents', 'scoreResults'],
  mode: 'background',
  async run(ctx) {
    const [players, periodic, endOfGame, scores] = await Promise.all([
      participants(ctx),
      statEvents(ctx, 'PeriodicXPBreakdown'),
      statEvents(ctx, 'EndOfGameXPBreakdown'),
      ctx.read('scoreResults'),
    ]);
    const finalSeconds = (ctx.replay.finalScoreLoop ?? ctx.replay.durationLoops) / 16;
    const rows: XpPointRow[] = [];
    for (const team of TEAMS) {
      let cumulative = 0;
      let seq = 0;
      const push = (p: Omit<XpPointRow, 'total' | 'cumulative' | 'seq' | 'team'>): void => {
        const total = p.minionXP + p.creepXP + p.structureXP + p.heroXP + p.trickleXP;
        cumulative += total;
        rows.push({ team, seq: seq++, ...p, total, cumulative });
      };
      for (const e of periodic.filter((e) => e.team === team)) {
        const v = (k: string): number => int(e, k) ?? 0;
        push({
          seconds: v('GameTime'),
          previousSeconds: v('PreviousGameTime'),
          teamLevel: int(e, 'TeamLevel'),
          minionXP: v('MinionXP'),
          creepXP: v('CreepXP'),
          structureXP: v('StructureXP'),
          heroXP: v('HeroXP'),
          trickleXP: v('TrickleXP'),
        });
      }
      const slots = new Set(players.filter((p) => p.team === team).map((p) => p.slot));
      const finals = endOfGame.filter((e) => e.playerSlot !== null && slots.has(e.playerSlot));
      if (finals.length > 0) {
        const sum = (k: XpSource): number => finals.reduce((a, e) => a + (int(e, k) ?? 0), 0);
        const last = rows.filter((r) => r.team === team).at(-1);
        push({
          seconds: finalSeconds,
          previousSeconds: last?.seconds ?? 0,
          teamLevel:
            scores.find((s) => slots.has(s.slot))?.stats['TeamLevel'] ?? last?.teamLevel ?? null,
          minionXP: sum('MinionXP'),
          creepXP: sum('CreepXP'),
          structureXP: sum('StructureXP'),
          heroXP: sum('HeroXP'),
          trickleXP: sum('TrickleXP'),
        });
      }
    }
    return { xpPoints: rows };
  },
};
