import type { Analyser, Team, UnitRecord } from '@myrddraall/heroprotocol-db';
import { gameSeconds } from '@myrddraall/heroprotocol-db';
import type { PlayerStatsRow } from './playerStats.js';
import { all, int, NS, otherTeam, participants, statEvents, str, TEAMS } from './shared.js';

/**
 * One row per team. Counts are whole numbers, damage/healing/XP are the game's points,
 * times are seconds; every `…Seconds` time is on the game's clock (from the gates opening).
 * `null` where the replay has no data for it (a build without the stat, an aborted game).
 */
export interface TeamStatsRow {
  readonly team: Team;
  readonly won: boolean;
  /** Takedowns this team scored: the other team's summed score Deaths. */
  readonly kills: number;
  /** This team's summed score Deaths. */
  readonly deaths: number;
  /** kills / max(deaths, 1). */
  readonly teamKDA: number;
  /**
   * Credited player killers per enemy hero death, both from `PlayerDeath` (the score's Deaths
   * and `PlayerDeath` differ for D.Va and Murky in a few games); null when no enemy died.
   */
  readonly peoplePerKill: number | null;
  /** The players' score values summed (null when the build records none of them). */
  readonly heroDamage: number | null;
  readonly siegeDamage: number | null;
  readonly healing: number | null;
  /** ProtectionGivenToAllies summed. */
  readonly shielding: number | null;
  readonly damageTaken: number | null;
  /** Total CC on enemy heroes (stuns, roots, silences, slows), seconds summed per enemy affected. */
  readonly ccSeconds: number | null;
  /** Seconds the team's players spent dead, summed. */
  readonly timeDead: number | null;
  /** timeDead per player. */
  readonly averageTimeDead: number | null;
  /** The team's final level. */
  readonly level: number | null;
  /** The team's XP by source at the end (EndOfGameXPBreakdown); totalXP is the five summed. */
  readonly minionXP: number | null;
  readonly creepXP: number | null;
  readonly structureXP: number | null;
  readonly heroXP: number | null;
  readonly trickleXP: number | null;
  readonly totalXP: number | null;
  /** Enemy forts (TownTownHallL2) and keeps (TownTownHallL3) this team destroyed. */
  readonly fortsDestroyed: number;
  readonly keepsDestroyed: number;
  /** This team's own structures destroyed by the enemy. Towers: TownCannonTower* turned dead. */
  readonly fortsLost: number;
  readonly keepsLost: number;
  readonly towersLost: number;
  readonly gatesLost: number;
  readonly wallsLost: number;
  readonly wellsLost: number;
  /** When this team destroyed its first enemy fort / keep; null if it never did. */
  readonly firstFortSeconds: number | null;
  readonly firstKeepSeconds: number | null;
  /** When this team's core died; null if it did not (or the map has none). */
  readonly coreSeconds: number | null;
  /** Mercenary and map camps this team captured (JungleCampCapture), and by CampType. */
  readonly campCaptures: number;
  readonly campsSiege: number;
  readonly campsBruiser: number;
  readonly campsBoss: number;
  /** Any other CampType (e.g. Blackheart's Bay's Doubloons Camp). */
  readonly campsOther: number;
  /** When this team captured its first camp; null if it never did. */
  readonly firstCampSeconds: number | null;
}

export type TeamStatsTables = {
  readonly teamStats: TeamStatsRow[];
};

type StructureKind = 'fort' | 'keep' | 'tower' | 'gate' | 'wall' | 'well' | 'core';

function structureKind(type: string): StructureKind | null {
  if (type.startsWith('TownTownHallL2')) return 'fort';
  if (type.startsWith('TownTownHallL3')) return 'keep';
  if (type.startsWith('TownCannonTower')) return 'tower';
  if (type.startsWith('TownGate')) return 'gate';
  if (type.startsWith('TownWallRadial')) return 'wall';
  if (type.startsWith('TownMoonwell')) return 'well';
  // Alterac Pass's cores are its generals
  if (type.startsWith('KingsCore') || type === 'VanndarStormpike' || type === 'DrekThar')
    return 'core';
  return null;
}

/** When a structure died: a tower turns into TownCannonTowerDead, the rest die. */
function deathLoop(u: UnitRecord, kind: StructureKind): number | null {
  if (kind === 'tower')
    return u.typeChanges.find((c) => c.type === 'TownCannonTowerDead')?.gameloop ?? null;
  return u.diedAtLoop;
}

function campBucket(campType: string): 'campsSiege' | 'campsBruiser' | 'campsBoss' | 'campsOther' {
  if (/siege/i.test(campType)) return 'campsSiege';
  if (/bruiser/i.test(campType)) return 'campsBruiser';
  if (/boss/i.test(campType)) return 'campsBoss';
  return 'campsOther';
}

const XP_SOURCES = ['MinionXP', 'CreepXP', 'StructureXP', 'HeroXP', 'TrickleXP'] as const;

/**
 * Team totals and team-only stats: kills and team KDA, people per kill, summed combat
 * stats, XP by source, structures destroyed and lost with the first fort/keep, the core's
 * death, and camps captured by type.
 */
export const teamStats: Analyser<TeamStatsTables> = {
  id: `${NS}team-stats`,
  version: 2,
  tables: { teamStats: '[replayId+team], replayId' },
  inputs: ['players', 'scoreResults', 'statEvents', 'units'],
  // cheap (no commands) and shown with the score tables, so it gates readiness like player-stats
  mode: 'ready',
  dependsOn: [`${NS}player-stats`],
  async run(ctx) {
    const [players, scores, stats, deaths, xpEnd, camps, units] = await Promise.all([
      participants(ctx),
      ctx.read('scoreResults'),
      ctx.readTable<PlayerStatsRow>('playerStats'),
      statEvents(ctx, 'PlayerDeath'),
      statEvents(ctx, 'EndOfGameXPBreakdown'),
      statEvents(ctx, 'JungleCampCapture'),
      ctx.read('units'),
    ]);
    const start = ctx.replay.gameStartLoop;
    const teamOfSlot = new Map(players.map((p) => [p.slot, p.team]));

    const statOf = (team: Team, name: string): number | null => {
      // a stat the build records for some roles only has no team total
      const support = ctx.statSupport[name]?.support ?? ctx.statSupport['*']?.support;
      if (support === 'partial' || support === 'none') return null;
      const values = stats.filter((s) => s.team === team).map((s) => s[name]);
      const nums = values.filter((v): v is number => typeof v === 'number');
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
    };
    const scoreDeaths = (team: Team): number =>
      scores.filter((s) => s.team === team).reduce((a, s) => a + (s.stats['Deaths'] ?? 0), 0);

    const structures = units.flatMap((u) => {
      // A town hall is what it was when it fell (Towers of Doom's forts become keeps); a tower
      // ends as TownCannonTowerDead, so it is what it was born as.
      const kind = structureKind(u.type) ?? structureKind(u.bornType ?? u.type);
      if (kind === null || u.ownerTeam === null) return [];
      const loop = deathLoop(u, kind);
      return loop === null ? [] : [{ kind, owner: u.ownerTeam, loop }];
    });
    const lost = (team: Team, kind: StructureKind): number =>
      structures.filter((s) => s.owner === team && s.kind === kind).length;
    const first = (loops: number[]): number | null =>
      loops.length === 0 ? null : gameSeconds(Math.min(...loops), start);

    const rows = TEAMS.map((team): TeamStatsRow => {
      const enemy = otherTeam(team);
      const kills = scoreDeaths(enemy);
      const deathsOwn = scoreDeaths(team);

      const enemyDeaths = deaths.filter((d) => d.team === enemy);
      const credited = enemyDeaths.reduce(
        (a, d) =>
          a +
          all(d, 'KillingPlayer')
            .map(Number)
            .filter((id) => id >= 1 && id <= 10 && teamOfSlot.get(id - 1) === team).length,
        0,
      );

      const size = players.filter((p) => p.team === team).length;
      const timeDead = statOf(team, 'TimeSpentDead');

      const slots = new Set(players.filter((p) => p.team === team).map((p) => p.slot));
      const xp = xpEnd.find((e) => e.playerSlot !== null && slots.has(e.playerSlot));
      const xpOf = (k: (typeof XP_SOURCES)[number]): number | null =>
        xp ? (int(xp, k) ?? 0) : null;
      const totalXP = xp ? XP_SOURCES.reduce((a, k) => a + (int(xp, k) ?? 0), 0) : null;

      const destroyed = structures.filter((s) => s.owner === enemy);
      const core = structures.find((s) => s.owner === team && s.kind === 'core');

      const mine = camps.filter((c) => c.team === team);
      const byType = { campsSiege: 0, campsBruiser: 0, campsBoss: 0, campsOther: 0 };
      for (const c of mine) byType[campBucket(str(c, 'CampType') ?? '')]++;

      return {
        team,
        won: ctx.replay.winningTeam === team,
        kills,
        deaths: deathsOwn,
        teamKDA: kills / Math.max(deathsOwn, 1),
        peoplePerKill: enemyDeaths.length === 0 ? null : credited / enemyDeaths.length,
        heroDamage: statOf(team, 'HeroDamage'),
        siegeDamage: statOf(team, 'SiegeDamage'),
        healing: statOf(team, 'Healing'),
        shielding: statOf(team, 'ProtectionGivenToAllies'),
        damageTaken: statOf(team, 'DamageTaken'),
        ccSeconds: statOf(team, 'TimeCCdEnemyHeroes'),
        timeDead,
        averageTimeDead: timeDead === null || size === 0 ? null : timeDead / size,
        level: scores.find((s) => s.team === team)?.stats['TeamLevel'] ?? null,
        minionXP: xpOf('MinionXP'),
        creepXP: xpOf('CreepXP'),
        structureXP: xpOf('StructureXP'),
        heroXP: xpOf('HeroXP'),
        trickleXP: xpOf('TrickleXP'),
        totalXP,
        fortsDestroyed: destroyed.filter((s) => s.kind === 'fort').length,
        keepsDestroyed: destroyed.filter((s) => s.kind === 'keep').length,
        fortsLost: lost(team, 'fort'),
        keepsLost: lost(team, 'keep'),
        towersLost: lost(team, 'tower'),
        gatesLost: lost(team, 'gate'),
        wallsLost: lost(team, 'wall'),
        wellsLost: lost(team, 'well'),
        firstFortSeconds: first(destroyed.filter((s) => s.kind === 'fort').map((s) => s.loop)),
        firstKeepSeconds: first(destroyed.filter((s) => s.kind === 'keep').map((s) => s.loop)),
        coreSeconds: core ? gameSeconds(core.loop, start) : null,
        campCaptures: mine.length,
        ...byType,
        firstCampSeconds: mine.length === 0 ? null : Math.min(...mine.map((c) => c.seconds)),
      };
    });
    return { teamStats: rows };
  },
};
