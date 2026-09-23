import type { Analyser } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref } from './shared.js';

export interface PlayerCommands extends PlayerRef {
  readonly commands: number;
  /** Commands with an ability link — casts, attacks and hero abilities; the rest are moves. */
  readonly casts: number;
  readonly moves: number;
  /** Commands per minute over the game. */
  readonly apm: number;
  readonly castsPerMinute: number;
  /** Commands in each minute of the game, index = minute. */
  readonly perMinute: readonly number[];
  /** Casts by ability link (numeric until hero-data maps names), descending by count. */
  readonly byAbility: readonly { readonly abilLink: number; readonly count: number }[];
}

/** Command volume per player: totals, APM and the per-minute curve. Lazy — it walks 20k+ rows. */
export const commands: Analyser<readonly PlayerCommands[]> = {
  id: `${NS}commands`,
  version: 1,
  inputs: ['players', 'commands'],
  mode: 'lazy',
  async run(ctx) {
    const players = await participants(ctx);
    const minutes = Math.max(1, Math.ceil(ctx.replay.durationSeconds / 60));
    const out: PlayerCommands[] = [];
    for (const [i, p] of players.entries()) {
      const rows = await ctx.read('commands', { playerSlot: p.slot });
      ctx.progress(i + 1, players.length);
      const perMinute = new Array<number>(minutes).fill(0);
      const byAbility = new Map<number, number>();
      let casts = 0;
      for (const c of rows) {
        const m = Math.min(minutes - 1, Math.floor(c.seconds / 60));
        perMinute[m]!++;
        if (c.abilLink !== null) {
          casts++;
          byAbility.set(c.abilLink, (byAbility.get(c.abilLink) ?? 0) + 1);
        }
      }
      const gameMinutes = ctx.replay.durationSeconds / 60 || 1;
      out.push({
        ...ref(p),
        commands: rows.length,
        casts,
        moves: rows.length - casts,
        apm: rows.length / gameMinutes,
        castsPerMinute: casts / gameMinutes,
        perMinute,
        byAbility: [...byAbility.entries()]
          .map(([abilLink, count]) => ({ abilLink, count }))
          .sort((a, b) => b.count - a.count || a.abilLink - b.abilLink),
      });
    }
    return out;
  },
};
