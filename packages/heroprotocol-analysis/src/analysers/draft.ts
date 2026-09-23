import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { bySlot, NS, participants } from './shared.js';

export interface DraftStep {
  readonly order: number;
  readonly type: 'ban' | 'pick';
  readonly team: Team | null;
  readonly heroId: string;
  readonly gameloop: number;
  /** Picks only. */
  readonly slot: number | null;
  readonly name: string | null;
  readonly hero: string | null;
}

export interface Draft {
  readonly picking: 'draft' | 'standard' | 'unknown';
  readonly private: boolean;
  readonly firstPickTeam: Team | null;
  readonly bans: readonly DraftStep[];
  readonly picks: readonly DraftStep[];
  /** Bans and picks interleaved in the order they actually happened. */
  readonly steps: readonly DraftStep[];
}

/**
 * The draft as it happened. The 2018 viewer reordered bans and picks by a per-mode
 * template; the tracker stream already carries the real order via gameloops.
 */
export const draft: Analyser<Draft> = {
  id: `${NS}draft`,
  version: 1,
  inputs: ['players'],
  mode: 'ready',
  async run(ctx) {
    const players = bySlot(await participants(ctx));
    const d = ctx.replay.draft;
    const bans = d.bans.map((b): DraftStep => ({
      order: 0,
      type: 'ban',
      team: b.team,
      heroId: b.heroId,
      gameloop: b.gameloop,
      slot: null,
      name: null,
      hero: null,
    }));
    const picks = d.picks.map((p): DraftStep => {
      const player = players.get(p.slot);
      return {
        order: 0,
        type: 'pick',
        team: player?.team ?? null,
        heroId: p.heroId,
        gameloop: p.gameloop,
        slot: p.slot,
        name: player?.name ?? null,
        hero: player?.hero ?? null,
      };
    });
    const steps = [...bans, ...picks]
      .sort((a, b) => a.gameloop - b.gameloop || (a.type === 'ban' ? -1 : 1))
      .map((s, i) => ({ ...s, order: i + 1 }));
    return {
      picking: d.picking,
      private: d.private,
      firstPickTeam: steps.find((s) => s.type === 'pick')?.team ?? null,
      bans: steps.filter((s) => s.type === 'ban'),
      picks: steps.filter((s) => s.type === 'pick'),
      steps,
    };
  },
};
