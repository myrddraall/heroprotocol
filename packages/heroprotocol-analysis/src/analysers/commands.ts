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
  version: 4,
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
        // minutes of the game's clock; orders before the gates open count in its first
        perMinute[Math.min(minutes - 1, Math.max(0, Math.floor(c.seconds / 60)))]!++;
        if (c.abilLink !== null) {
          casts++;
          byAbility.set(c.abilLink, (byAbility.get(c.abilLink) ?? 0) + 1);
        }
      }
      // rates over the game's clock: orders from before the gates open don't count, and a game
      // shorter than a minute counts as one
      const gameMinutes = Math.max(1, ctx.replay.durationSeconds / 60);
      const inGame = rows.filter((c) => c.seconds >= 0);
      const castsInGame = inGame.filter((c) => c.abilLink !== null).length;
      stats.push({
        ...ref(p),
        commands: rows.length,
        casts,
        moves: rows.length - casts,
        apm: inGame.length / gameMinutes,
        castsPerMinute: castsInGame / gameMinutes,
        perMinute,
      });
      for (const [abilLink, count] of [...byAbility.entries()].sort((a, b) => a[0] - b[0]))
        uses.push({ slot: p.slot, abilLink, count });
    }
    return { commandStats: stats, abilityUses: uses };
  },
};
