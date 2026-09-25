import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, otherTeam, participants, ref, scoreOf, sumBy, TEAMS } from './shared.js';

/** The ten stats the score screen shows, as the 2018 viewer listed them. */
export const SCORE_SCREEN_STATS = [
  'Takedowns',
  'Deaths',
  'SoloKill',
  'Assists',
  'ExperienceContribution',
  'Healing',
  'SiegeDamage',
  'HeroDamage',
  'DamageTaken',
  'TeamLevel',
] as const;

export type ScoreScreenStat = (typeof SCORE_SCREEN_STATS)[number];

/** One row per player; the ten stats are columns so any of them can be indexed or queried. */
export interface ScoreScreenPlayerRow extends PlayerRef, Record<ScoreScreenStat, number | null> {
  readonly silenced: boolean;
  readonly voiceSilenced: boolean;
  readonly awards: readonly string[];
  readonly mvp: boolean;
}

export interface ScoreScreenTeamRow {
  readonly team: Team;
  readonly level: number | null;
  /** Takedowns scored by this team: the other team's deaths. */
  readonly kills: number;
  readonly won: boolean;
  readonly gameloop: number | null;
}

export type ScoreScreenTables = {
  readonly scoreScreenPlayers: ScoreScreenPlayerRow[];
  readonly scoreScreenTeams: ScoreScreenTeamRow[];
};

export const scoreScreen: Analyser<ScoreScreenTables> = {
  id: `${NS}score-screen`,
  version: 2,
  tables: {
    scoreScreenPlayers:
      '[replayId+slot], replayId, heroId, name, team, won, mvp, Takedowns, HeroDamage, *awards',
    scoreScreenTeams: '[replayId+team], replayId',
  },
  inputs: ['players', 'scoreResults'],
  mode: 'ready',
  async run(ctx) {
    const [players, scores] = await Promise.all([participants(ctx), ctx.read('scoreResults')]);
    const rows = players.map((p): ScoreScreenPlayerRow => {
      const score = scoreOf(scores, p.slot);
      const stats = Object.fromEntries(
        SCORE_SCREEN_STATS.map((name) => [name, score?.stats[name] ?? null]),
      ) as Record<ScoreScreenStat, number | null>;
      const awards = score?.awards ?? [];
      return {
        ...ref(p),
        silenced: p.silenced,
        voiceSilenced: p.voiceSilenced,
        awards,
        mvp: awards.includes('MVP'),
        ...stats,
      };
    });
    const teams = TEAMS.map((team): ScoreScreenTeamRow => {
      const mine = rows.filter((r) => r.team === team);
      const theirs = rows.filter((r) => r.team === otherTeam(team));
      return {
        team,
        level: mine.find((r) => r.TeamLevel !== null)?.TeamLevel ?? null,
        kills: sumBy(theirs, (r) => r.Deaths),
        won: ctx.replay.winningTeam === team,
        gameloop: scores[0]?.gameloop ?? null,
      };
    });
    return { scoreScreenPlayers: rows, scoreScreenTeams: teams };
  },
};
