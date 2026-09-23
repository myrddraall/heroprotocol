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

export interface ScoreScreenPlayer extends PlayerRef {
  readonly silenced: boolean;
  readonly voiceSilenced: boolean;
  readonly stats: Readonly<Record<ScoreScreenStat, number | null>>;
  readonly awards: readonly string[];
}

export interface ScoreScreenTeam {
  readonly team: Team;
  readonly level: number | null;
  /** Takedowns scored by this team: the other team's deaths. */
  readonly kills: number;
  readonly won: boolean;
}

export interface ScoreScreen {
  readonly winningTeam: Team | null;
  readonly gameloop: number | null;
  readonly teams: readonly ScoreScreenTeam[];
  readonly players: readonly ScoreScreenPlayer[];
}

export const scoreScreen: Analyser<ScoreScreen> = {
  id: `${NS}score-screen`,
  version: 1,
  inputs: ['players', 'scoreResults'],
  mode: 'ready',
  async run(ctx) {
    const [players, scores] = await Promise.all([participants(ctx), ctx.read('scoreResults')]);
    const rows = players.map((p): ScoreScreenPlayer => {
      const score = scoreOf(scores, p.slot);
      const stats = Object.fromEntries(
        SCORE_SCREEN_STATS.map((name) => [name, score?.stats[name] ?? null]),
      ) as Record<ScoreScreenStat, number | null>;
      return {
        ...ref(p),
        silenced: p.silenced,
        voiceSilenced: p.voiceSilenced,
        stats,
        awards: score?.awards ?? [],
      };
    });
    const teams = TEAMS.map((team): ScoreScreenTeam => {
      const mine = rows.filter((r) => r.team === team);
      const theirs = rows.filter((r) => r.team === otherTeam(team));
      return {
        team,
        level: mine.find((r) => r.stats.TeamLevel !== null)?.stats.TeamLevel ?? null,
        kills: sumBy(theirs, (r) => r.stats.Deaths),
        won: ctx.replay.winningTeam === team,
      };
    });
    return {
      winningTeam: ctx.replay.winningTeam,
      gameloop: scores[0]?.gameloop ?? null,
      teams,
      players: rows,
    };
  },
};
