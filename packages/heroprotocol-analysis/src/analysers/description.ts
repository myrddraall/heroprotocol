import type { Analyser, GameMode, ReplayVersion, Team } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref } from './shared.js';

export interface DescriptionPlayer extends PlayerRef {
  readonly kind: 'player' | 'ai';
  readonly role: string | null;
  readonly level: number | null;
  readonly talents: number;
  /** Seconds into the game at which the player left for good, if they did. */
  readonly leftAtSeconds: number | null;
}

/** What a replay list needs: the 2018 `ReplayDescription`, with slots and hero ids added. */
export interface Description {
  readonly id: string;
  readonly map: string;
  readonly mode: GameMode;
  readonly ammId: number;
  readonly playedAt: string;
  readonly timeZoneOffsetHours: number;
  readonly durationSeconds: number;
  readonly durationLoops: number;
  readonly version: ReplayVersion;
  readonly winningTeam: Team | null;
  readonly region: number | null;
  readonly picking: 'draft' | 'standard' | 'unknown';
  readonly private: boolean;
  readonly players: readonly DescriptionPlayer[];
}

export const description: Analyser<Description> = {
  id: `${NS}description`,
  version: 1,
  inputs: ['players'],
  mode: 'ready',
  async run(ctx) {
    const r = ctx.replay;
    const players = (await participants(ctx)).map((p): DescriptionPlayer => ({
      ...ref(p),
      kind: p.kind === 'ai' ? 'ai' : 'player',
      role: p.role,
      level: p.level,
      talents: p.talents.length,
      leftAtSeconds: p.leftAtLoop === null ? null : p.leftAtLoop / 16,
    }));
    return {
      id: r.id,
      map: r.map,
      mode: r.mode,
      ammId: r.ammId,
      playedAt: r.playedAt,
      timeZoneOffsetHours: r.timeZoneOffsetHours,
      durationSeconds: r.durationSeconds,
      durationLoops: r.durationLoops,
      version: r.version,
      winningTeam: r.winningTeam,
      region: r.region,
      picking: r.draft.picking,
      private: r.draft.private,
      players,
    };
  },
};
