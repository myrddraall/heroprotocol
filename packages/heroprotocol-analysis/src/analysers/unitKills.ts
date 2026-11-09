import type { Analyser, Team, UnitRecord } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref, statEvents, TEAMS } from './shared.js';

/** The 2018 UnitAnalyser's mercenary classification, by unit type name. */
export const MERC_TYPES: Readonly<
  Record<
    string,
    {
      readonly kind: 'siege' | 'bruiser' | 'sapper' | 'item' | 'boss';
      readonly mode: 'camp' | 'lane';
    }
  >
> = {
  MercDefenderSiegeGiant: { kind: 'siege', mode: 'camp' },
  TerranHellbatDefender: { kind: 'siege', mode: 'camp' },
  MercSiegeTrooperDefender: { kind: 'siege', mode: 'camp' },
  MercLanerSiegeGiant: { kind: 'siege', mode: 'lane' },
  TerranHellbat: { kind: 'siege', mode: 'lane' },
  MercSiegeTrooperLaner: { kind: 'siege', mode: 'lane' },
  MercDefenderMeleeKnight: { kind: 'bruiser', mode: 'camp' },
  MercDefenderRangedMage: { kind: 'bruiser', mode: 'camp' },
  TerranGoliathDefender: { kind: 'bruiser', mode: 'camp' },
  TerranRavenDefender: { kind: 'bruiser', mode: 'camp' },
  MercSummonerDefenderMinion: { kind: 'bruiser', mode: 'camp' },
  MercSummonerDefender: { kind: 'bruiser', mode: 'camp' },
  MercLanerMeleeKnight: { kind: 'bruiser', mode: 'lane' },
  MercLanerRangedMage: { kind: 'bruiser', mode: 'lane' },
  TerranGoliath: { kind: 'bruiser', mode: 'lane' },
  TerranRaven: { kind: 'bruiser', mode: 'lane' },
  MercSummonerLanerMinion: { kind: 'bruiser', mode: 'lane' },
  MercSummonerLaner: { kind: 'bruiser', mode: 'lane' },
  MercGoblinSapperDefender: { kind: 'sapper', mode: 'camp' },
  MercGoblinSapperLaner: { kind: 'sapper', mode: 'lane' },
  OverwatchTurret: { kind: 'item', mode: 'camp' },
  OverwatchMechanic: { kind: 'item', mode: 'camp' },
  MercDefenderMeleeIndividual: { kind: 'item', mode: 'camp' },
  JungleGraveGolemDefender: { kind: 'boss', mode: 'camp' },
  SlimeBossDefender: { kind: 'boss', mode: 'camp' },
  JungleGraveGolemLaner: { kind: 'boss', mode: 'lane' },
  SlimeBossLaner: { kind: 'boss', mode: 'lane' },
};

export interface KillCounts {
  readonly minions: number;
  readonly mercsCamp: number;
  readonly mercsLane: number;
  readonly bossCamp: number;
  readonly bossLane: number;
  readonly structures: number;
  /**
   * Heroes killed: each death the game recorded (`PlayerDeath`), by the killing blow. The score
   * screen counts some heroes' deaths as less (Murky, each of The Lost Vikings), so its Kills can
   * be lower.
   */
  readonly heroes: number;
  /**
   * Other hero units killed without their player dying: D.Va's mech, Abathur's clones, Chen's
   * spirits and the like. Counted in `total`, not in `heroes`.
   */
  readonly heroUnits: number;
  readonly summons: number;
  readonly other: number;
  readonly total: number;
}

export interface PlayerKillsRow extends PlayerRef, KillCounts {}

export interface TeamKillsRow extends KillCounts {
  readonly team: Team;
}

export type UnitKillsTables = {
  readonly unitKills: PlayerKillsRow[];
  readonly teamUnitKills: TeamKillsRow[];
};

function classify(u: UnitRecord): keyof Omit<KillCounts, 'total'> {
  const merc = MERC_TYPES[u.type] ?? MERC_TYPES[u.bornType ?? ''];
  if (merc) {
    if (merc.kind === 'boss') return merc.mode === 'camp' ? 'bossCamp' : 'bossLane';
    return merc.mode === 'camp' ? 'mercsCamp' : 'mercsLane';
  }
  switch (u.unitClass) {
    case 'minion':
      return 'minions';
    case 'mercenary':
      return 'mercsCamp';
    case 'structure':
    case 'core':
      return 'structures';
    case 'hero':
      return 'heroes';
    case 'summon':
      return 'summons';
    default:
      return 'other';
  }
}

function empty(): Record<keyof KillCounts, number> {
  return {
    minions: 0,
    mercsCamp: 0,
    mercsLane: 0,
    bossCamp: 0,
    bossLane: 0,
    structures: 0,
    heroes: 0,
    heroUnits: 0,
    summons: 0,
    other: 0,
    total: 0,
  };
}

/**
 * Kills credited to each player and team by the tracker's `m_killerPlayerId`, split the way the
 * 2018 viewer did. Heroes are counted per recorded player death (`PlayerDeath`), each
 * credited to the enemy whose unit landed the killing blow (the hero's `HeroDied` at that moment):
 * a hero is one unit revived after each death, so its unit row keeps only a death it never came
 * back from. The other hero units an enemy killed without their player dying (D.Va's mech,
 * Abathur's clones, Chen's spirits) are `heroUnits`.
 */
/** How far apart (game loops) a `PlayerDeath` and its hero's `HeroDied` may be and still match. */
const SAME_DEATH_LOOPS = 16;

export const unitKills: Analyser<UnitKillsTables> = {
  id: `${NS}unit-kills`,
  version: 5,
  tables: {
    unitKills: '[replayId+slot], replayId, heroId, team, minions, heroes, total',
    teamUnitKills: '[replayId+team], replayId',
  },
  inputs: ['players', 'units', 'events', 'statEvents'],
  mode: 'ready', // player-stats (ready) depends on it
  async run(ctx) {
    const [players, units, heroDied, deaths] = await Promise.all([
      participants(ctx),
      ctx.read('units'),
      ctx.read('events', { kind: 'HeroDied' }),
      statEvents(ctx, 'PlayerDeath'),
    ]);
    const perSlot = new Map(players.map((p) => [p.slot, empty()]));
    const perTeam = new Map(TEAMS.map((t) => [t, empty()]));
    const teamOf = new Map(players.map((p) => [p.slot, p.team]));
    const credit = (killerSlot: number | null, bucket: keyof Omit<KillCounts, 'total'>): void => {
      if (killerSlot === null) return;
      const counts = perSlot.get(killerSlot);
      if (!counts) return;
      counts[bucket]++;
      counts.total++;
      const team = perTeam.get(teamOf.get(killerSlot) as Team);
      if (team) {
        team[bucket]++;
        team.total++;
      }
    };
    for (const u of units) {
      // heroes come from their deaths below
      if (u.diedAtLoop === null || u.unitClass === 'hero') continue;
      credit(u.killerSlot, classify(u));
    }
    /** The `HeroDied` events that were a player's death; the rest were other hero units'. */
    const playerDeaths = new Set<(typeof heroDied)[number]>();
    for (const d of deaths) {
      if (d.playerSlot === null) continue;
      // the killing blow, from the hero's own death at that moment: only a player's death counts,
      // not the other hero units that die (D.Va's mech, Abathur's clones, Chen's spirits)
      const blow = heroDied
        .filter(
          (e) =>
            e.playerSlot === d.playerSlot && Math.abs(e.gameloop - d.gameloop) <= SAME_DEATH_LOOPS,
        )
        .sort((a, b) => Math.abs(a.gameloop - d.gameloop) - Math.abs(b.gameloop - d.gameloop))[0];
      if (blow) playerDeaths.add(blow);
      const killer = blow?.data['killerSlot'];
      // an enemy's killing blow only: a hero's own unit can end its life (Uther's spirit)
      if (typeof killer !== 'number' || teamOf.get(killer) === teamOf.get(d.playerSlot)) continue;
      credit(killer, 'heroes');
    }
    for (const e of heroDied) {
      if (playerDeaths.has(e) || e.playerSlot === null) continue;
      const killer = e.data['killerSlot'];
      if (typeof killer !== 'number' || teamOf.get(killer) === teamOf.get(e.playerSlot)) continue;
      credit(killer, 'heroUnits');
    }
    return {
      unitKills: players.map((p) => ({ ...ref(p), ...perSlot.get(p.slot)! })),
      teamUnitKills: TEAMS.map((team) => ({ team, ...perTeam.get(team)! })),
    };
  },
};
