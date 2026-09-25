import type { Analyser } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref } from './shared.js';

/** One row per talent pick. Names are the game's internal talent ids; hero-data maps them to display names. */
export interface TalentPickRow extends PlayerRef {
  /** 1-based tier in pick order (1, 4, 7, 10, 13, 16, 20 in a full game). */
  readonly tier: number;
  readonly level: number;
  readonly talent: string;
  readonly seconds: number;
  readonly gameloop: number;
}

export type TalentsTables = {
  readonly talentPicks: TalentPickRow[];
};

export const talents: Analyser<TalentsTables> = {
  id: `${NS}talents`,
  version: 2,
  tables: { talentPicks: '[replayId+slot+tier], replayId, [replayId+slot], heroId, talent, level' },
  inputs: ['players'],
  mode: 'background',
  async run(ctx) {
    const rows: TalentPickRow[] = [];
    for (const p of await participants(ctx)) {
      p.talents.forEach((t, i) =>
        rows.push({
          ...ref(p),
          tier: i + 1,
          level: t.level,
          talent: t.name,
          seconds: t.gameloop / 16,
          gameloop: t.gameloop,
        }),
      );
    }
    return { talentPicks: rows };
  },
};
