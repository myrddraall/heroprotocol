import type { Analyser } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref } from './shared.js';

export interface CommandStatsRow extends PlayerRef {
  readonly commands: number;
  /** Commands with an ability link — casts, attacks and hero abilities; the rest are moves. */
  readonly casts: number;
  readonly moves: number;
  /** Commands per minute over the game. */
  readonly apm: number;
  readonly castsPerMinute: number;
  /** Commands in each minute of the game, index = minute. */
  readonly perMinute: readonly number[];
}

/** One row per (player, ability link): casts by ability. Links stay numeric until hero-data maps names. */
export interface AbilityUseRow {
  readonly slot: number;
  readonly abilLink: number;
  readonly count: number;
}

export type CommandsTables = {
  readonly commandStats: CommandStatsRow[];
  readonly abilityUses: AbilityUseRow[];
};

/** Command volume per player: totals, APM, the per-minute curve, and casts by ability. Lazy — it walks 20k+ rows. */
export const commands: Analyser<CommandsTables> = {
  id: `${NS}commands`,
  version: 2,
  tables: {
    commandStats: '[replayId+slot], replayId, heroId, apm',
    abilityUses: '[replayId+slot+abilLink], replayId, [replayId+slot], abilLink',
  },
  inputs: ['players', 'commands'],
  mode: 'lazy',
  async run(ctx) {
    const players = await participants(ctx);
    const minutes = Math.max(1, Math.ceil(ctx.replay.durationSeconds / 60));
    const stats: CommandStatsRow[] = [];
    const uses: AbilityUseRow[] = [];
    for (const [i, p] of players.entries()) {
      const rows = await ctx.read('commands', { playerSlot: p.slot });
      ctx.progress(i + 1, players.length);
      const perMinute = new Array<number>(minutes).fill(0);
      const byAbility = new Map<number, number>();
      let casts = 0;
      for (const c of rows) {
        perMinute[Math.min(minutes - 1, Math.floor(c.seconds / 60))]!++;
        if (c.abilLink !== null) {
          casts++;
          byAbility.set(c.abilLink, (byAbility.get(c.abilLink) ?? 0) + 1);
        }
      }
      const gameMinutes = ctx.replay.durationSeconds / 60 || 1;
      stats.push({
        ...ref(p),
        commands: rows.length,
        casts,
        moves: rows.length - casts,
        apm: rows.length / gameMinutes,
        castsPerMinute: casts / gameMinutes,
        perMinute,
      });
      for (const [abilLink, count] of [...byAbility.entries()].sort((a, b) => a[0] - b[0]))
        uses.push({ slot: p.slot, abilLink, count });
    }
    return { commandStats: stats, abilityUses: uses };
  },
};
