import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { gameSeconds } from '@myrddraall/heroprotocol-db';
import { int, NS, participants, statEvents, TEAMS } from './shared.js';

export interface XpPointRow {
  readonly team: Team;
  /** Position within the team's curve. */
  readonly seq: number;
  /** On the game's clock (from the gates opening), as the breakdowns' own GameTime. */
  readonly seconds: number;
  readonly previousSeconds: number;
  readonly teamLevel: number | null;
  /** The team's XP from each source so far (the game's breakdowns are running totals). */
  readonly minionXP: number;
  readonly creepXP: number;
  readonly structureXP: number;
  readonly heroXP: number;
  readonly trickleXP: number;
  /** The team's XP so far: the five sources summed. */
  readonly total: number;
  /** XP the team earned since the previous point. */
  readonly gained: number;
}

export type XpCurveTables = {
  readonly xpPoints: XpPointRow[];
};

type XpSource = 'MinionXP' | 'CreepXP' | 'StructureXP' | 'HeroXP' | 'TrickleXP';

/**
 * Per-team XP by source over time: the periodic breakdowns (running totals, once a minute of
 * game time), closed by the end-of-game breakdown. The game writes the end-of-game breakdown once
 * per player but each holds the whole team's, so one player's is the team's final point, as the
 * 2018 XPAnalyser had it.
 */
export const xpCurve: Analyser<XpCurveTables> = {
  id: `${NS}xp-curve`,
  version: 3,
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
    const finalSeconds = gameSeconds(
      ctx.replay.finalScoreLoop ?? ctx.replay.durationLoops,
      ctx.replay.gameStartLoop,
    );
    const rows: XpPointRow[] = [];
    for (const team of TEAMS) {
      let previous = 0;
      let seq = 0;
      const push = (p: Omit<XpPointRow, 'total' | 'gained' | 'seq' | 'team'>): void => {
        const total = p.minionXP + p.creepXP + p.structureXP + p.heroXP + p.trickleXP;
        rows.push({ team, seq: seq++, ...p, total, gained: total - previous });
        previous = total;
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
      const final = endOfGame.find((e) => e.playerSlot !== null && slots.has(e.playerSlot));
      if (final) {
        const xp = (k: XpSource): number => int(final, k) ?? 0;
        const last = rows.filter((r) => r.team === team).at(-1);
        push({
          seconds: finalSeconds,
          previousSeconds: last?.seconds ?? 0,
          teamLevel:
            scores.find((s) => slots.has(s.slot))?.stats['TeamLevel'] ?? last?.teamLevel ?? null,
          minionXP: xp('MinionXP'),
          creepXP: xp('CreepXP'),
          structureXP: xp('StructureXP'),
          heroXP: xp('HeroXP'),
          trickleXP: xp('TrickleXP'),
        });
      }
    }
    return { xpPoints: rows };
  },
};
