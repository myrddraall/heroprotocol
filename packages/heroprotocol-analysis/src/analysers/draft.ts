import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { bySlot, NS, participants } from './shared.js';

export interface DraftStepRow {
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

export interface DraftRow {
  readonly picking: 'draft' | 'standard' | 'unknown';
  readonly private: boolean;
  readonly firstPickTeam: Team | null;
  readonly bans: number;
  readonly picks: number;
}

export type DraftTables = {
  readonly draft: DraftRow[];
  readonly draftSteps: DraftStepRow[];
};

/**
 * The draft as it happened, one row per step. The 2018 viewer reordered bans and picks
 * by a per-mode template; the tracker stream already carries the real order.
 */
export const draft: Analyser<DraftTables> = {
  id: `${NS}draft`,
  version: 2,
  tables: {
    draft: 'replayId, picking, firstPickTeam',
    draftSteps: '[replayId+order], replayId, type, heroId, team, slot',
  },
  inputs: ['players'],
  mode: 'ready',
  async run(ctx) {
    const players = bySlot(await participants(ctx));
    const d = ctx.replay.draft;
    const bans = d.bans.map((b): DraftStepRow => ({
      order: 0,
      type: 'ban',
      team: b.team,
      heroId: b.heroId,
      gameloop: b.gameloop,
      slot: null,
      name: null,
      hero: null,
    }));
    const picks = d.picks.map((p): DraftStepRow => {
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
      draft: [
        {
          picking: d.picking,
          private: d.private,
          firstPickTeam: steps.find((s) => s.type === 'pick')?.team ?? null,
          bans: bans.length,
          picks: picks.length,
        },
      ],
      draftSteps: steps,
    };
  },
};
