import type { Analyser } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref } from './shared.js';

export interface TalentPickRow {
  /** 1-based tier in pick order (1, 4, 7, 10, 13, 16, 20 in a full game). */
  readonly tier: number;
  readonly level: number;
  readonly name: string;
  readonly seconds: number;
  readonly gameloop: number;
}

export interface PlayerTalents extends PlayerRef {
  readonly talents: readonly TalentPickRow[];
}

/** Talent choices per player, in pick order. Names are the game's internal talent ids; hero-data maps them to display names. */
export const talents: Analyser<readonly PlayerTalents[]> = {
  id: `${NS}talents`,
  version: 1,
  inputs: ['players'],
  mode: 'background',
  async run(ctx) {
    return (await participants(ctx)).map((p) => ({
      ...ref(p),
      talents: p.talents.map((t, i) => ({
        tier: i + 1,
        level: t.level,
        name: t.name,
        seconds: t.gameloop / 16,
        gameloop: t.gameloop,
      })),
    }));
  },
};
