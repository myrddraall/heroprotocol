import type { Analyser, Team, UnitRecord } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import { NS, participants, ref, TEAMS } from './shared.js';

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
  readonly heroes: number;
  readonly summons: number;
  readonly other: number;
  readonly total: number;
}

export interface PlayerKills extends PlayerRef {
  readonly kills: KillCounts;
}

export interface UnitKills {
  readonly players: readonly PlayerKills[];
  readonly teams: readonly { readonly team: Team; readonly kills: KillCounts }[];
}

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
    summons: 0,
    other: 0,
    total: 0,
  };
}

/** Kills credited to each player and team by the tracker's `m_killerPlayerId`, split the way the 2018 viewer did. */
export const unitKills: Analyser<UnitKills> = {
  id: `${NS}unit-kills`,
  version: 1,
  inputs: ['players', 'units'],
  mode: 'ready', // player-stats (ready) depends on it
  async run(ctx) {
    const [players, units] = await Promise.all([participants(ctx), ctx.read('units')]);
    const perSlot = new Map(players.map((p) => [p.slot, empty()]));
    const perTeam = new Map(TEAMS.map((t) => [t, empty()]));
    for (const u of units) {
      if (u.diedAtLoop === null || u.killerSlot === null) continue;
      const counts = perSlot.get(u.killerSlot);
      if (!counts) continue;
      const bucket = classify(u);
      counts[bucket]++;
      counts.total++;
      const team = perTeam.get(players.find((p) => p.slot === u.killerSlot)?.team as Team);
      if (team) {
        team[bucket]++;
        team.total++;
      }
    }
    return {
      players: players.map((p) => ({ ...ref(p), kills: perSlot.get(p.slot)! })),
      teams: TEAMS.map((team) => ({ team, kills: perTeam.get(team)! })),
    };
  },
};
