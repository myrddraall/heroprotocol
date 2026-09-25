import type { Analyser, StatSupportTable, Team } from '@myrddraall/heroprotocol-db';
import type { PlayerRef } from './shared.js';
import {
  all,
  int,
  NS,
  otherTeam,
  participants,
  ref,
  scoreOf,
  statEvents,
  sumBy,
  TEAMS,
} from './shared.js';
import type { PlayerKillsRow } from './unitKills.js';

/**
 * One row per player: every recorded stat plus the derived ones, each as a column
 * (`null` where the build does not support it), so any stat can be queried and indexed.
 */
export interface PlayerStatsRow extends PlayerRef {
  readonly silenced: boolean;
  readonly voiceSilenced: boolean;
  readonly [stat: string]: unknown;
}

export interface PlayerStatsSupportRow {
  readonly statSupport: StatSupportTable;
}

export type PlayerStatsTables = {
  readonly playerStats: PlayerStatsRow[];
  readonly playerStatsSupport: PlayerStatsSupportRow[];
};

/** Score instances the 2018 viewer left out of the full table. */
function isTableStat(name: string): boolean {
  return (
    !name.endsWith('Boolean') &&
    !name.endsWith('Talent') &&
    !name.startsWith('Plays') &&
    !name.startsWith('Wins') &&
    !name.startsWith('TeamWins') &&
    !name.endsWith('Level') &&
    name !== 'Role' &&
    name !== 'GameScore'
  );
}

const TEAM_SUMS = [
  'DamageTaken',
  'TeamfightDamageTaken',
  'DamageSoaked',
  'HeroDamage',
  'TeamfightHeroDamage',
  'SiegeDamage',
  'MinionDamage',
  'StructureDamage',
  'CreepDamage',
  'Healing',
  'ProtectionGivenToAllies',
  'TeamfightHealingDone',
] as const;

/**
 * The full per-player table: every score-screen stat the build recorded, the
 * tracker-derived counts (minions, mercs, globes, solo kills, disconnects) and the
 * ratios and percentages the 2018 viewer computed, with the build's stat-support
 * table applied (unsupported stats are `null`, not zero).
 */
export const playerStats: Analyser<PlayerStatsTables> = {
  id: `${NS}player-stats`,
  version: 2,
  tables: {
    playerStats:
      '[replayId+slot], replayId, heroId, name, team, Takedowns, Deaths, HeroDamage, SiegeDamage, Healing, ExperienceContribution, KillParticipation',
    playerStatsSupport: 'replayId',
  },
  inputs: ['players', 'scoreResults', 'statEvents', 'events'],
  mode: 'ready',
  dependsOn: [`${NS}unit-kills`],
  async run(ctx) {
    const [players, scores, deaths, globes, votes, leaves, joins, kills] = await Promise.all([
      participants(ctx),
      ctx.read('scoreResults'),
      statEvents(ctx, 'PlayerDeath'),
      statEvents(ctx, 'RegenGlobePickedUp'),
      statEvents(ctx, 'EndOfGameUpVotesCollected'),
      ctx.read('events', { kind: 'PlayerLeft' }),
      ctx.read('events', { kind: 'PlayerJoined' }),
      ctx.readTable<PlayerKillsRow>('unitKills'),
    ]);
    const gameSeconds = ctx.replay.durationSeconds;
    const unsupported = (name: string): boolean =>
      ctx.statSupport[name]?.support === 'none' || ctx.statSupport['*']?.support === 'none';
    const warriorsOnly = (name: string): boolean => ctx.statSupport[name]?.support === 'partial';

    const table = new Map<number, Record<string, number | null>>();
    for (const p of players) {
      const stats: Record<string, number | null> = {};
      const score = scoreOf(scores, p.slot);
      for (const [name, value] of Object.entries(score?.stats ?? {}))
        if (isTableStat(name)) stats[name] = value;
      const playerId = p.slot + 1;

      const myLeaves = leaves.filter(
        (e) => e.playerSlot === p.slot && (e.data['reason'] as number) !== 0,
      );
      const myJoins = joins.filter((e) => e.playerSlot === p.slot && e.gameloop > 0);
      stats['Disconnects'] = myLeaves.length;
      stats['Reconnects'] = myJoins.length;
      stats['VotesReceived'] = votes.filter((v) => int(v, 'Player') === playerId).length;
      const k = kills.find((r) => r.slot === p.slot);
      stats['MinionsKilled'] = k?.minions ?? null;
      stats['MercsKilledCamp'] = k?.mercsCamp ?? null;
      stats['MercsKilledLane'] = k?.mercsLane ?? null;
      stats['BossKilledCamp'] = k?.bossCamp ?? null;
      stats['BossKilledLane'] = k?.bossLane ?? null;
      stats['RegenGlobesCollected'] = globes.filter((g) => g.playerSlot === p.slot).length;
      stats['Kills'] = stats['SoloKill'] ?? null;
      stats['SoloKill'] = deaths.filter((d) => {
        const killers = all(d, 'KillingPlayer').map(Number);
        return killers.includes(playerId) && !killers.some((id) => id <= 10 && id !== playerId);
      }).length;
      stats['DeathsToNPCs'] = deaths.filter((d) => {
        const killers = all(d, 'KillingPlayer').map(Number);
        return d.playerSlot === p.slot && killers.length === 1 && killers[0]! > 10;
      }).length;

      const presence = [
        ...myLeaves.map((e) => ({ loop: e.gameloop, left: true })),
        ...myJoins.map((e) => ({ loop: e.gameloop, left: false })),
      ].sort((a, b) => a.loop - b.loop);
      let away = 0;
      let since: number | null = null;
      for (const e of presence) {
        if (e.left) since ??= e.loop;
        else if (since !== null) {
          away += e.loop - since;
          since = null;
        }
      }
      if (since !== null) away += ctx.replay.durationLoops - since;
      stats['TimeDisconnected'] = away / 16;
      stats['PercentOfGameDisconnected'] = gameSeconds > 0 ? away / 16 / gameSeconds : 0;

      const cc = stats['TimeCCdEnemyHeroes'];
      if (cc !== null && cc !== undefined) {
        const silence = stats['TimeSilencingEnemyHeroes'] ?? 0;
        stats['TimeCCdEnemyHeroes'] = cc + silence; // as the 2018 viewer did: silences were not included by the game
        stats['TimeSlowedEnemyHeroes'] =
          cc - (stats['TimeRootingEnemyHeroes'] ?? 0) - (stats['TimeStunningEnemyHeroes'] ?? 0);
      }
      table.set(p.slot, stats);
    }

    const teamSum = (team: Team, name: string): number =>
      sumBy(
        players.filter((p) => p.team === team),
        (p) => table.get(p.slot)?.[name],
      );
    const teamTakedowns = TEAMS.map((t) => teamSum(otherTeam(t), 'Deaths'));
    const sums = new Map<string, number[]>(
      TEAM_SUMS.map((name) => [name, TEAMS.map((t) => teamSum(t, name))]),
    );
    const heroDamageAgainst = TEAMS.map((t) => teamSum(otherTeam(t), 'HeroDamage'));

    for (const p of players) {
      const s = table.get(p.slot)!;
      const team = p.team ?? 0;
      const n = (name: string): number => s[name] ?? 0;
      const lives = n('Deaths') + 1;
      const pct = (name: string, sumName: string): number =>
        n(name) / (sums.get(sumName)![team] || 1);
      s['KillParticipation'] = teamTakedowns[team] ? n('Takedowns') / teamTakedowns[team]! : 0;
      s['AverageHeroDamagePerLife'] = n('HeroDamage') / lives;
      s['AverageTeamfightHeroDamagePerLife'] = n('TeamfightHeroDamage') / lives;
      s['AverageSiegeDamagePerLife'] = n('SiegeDamage') / lives;
      s['AverageHealingPerLife'] = n('Healing') / lives;
      s['AverageTeamfightHealingPerLife'] = n('TeamfightHealingDone') / lives;
      s['AverageDamageTakenPerLife'] = n('DamageTaken') / lives;
      s['AverageTeamfightDamageTakenPerLife'] = n('TeamfightDamageTaken') / lives;
      s['AverageDamageSoakedPerLife'] = n('DamageSoaked') / lives;
      s['KDARatio'] = n('Takedowns') / lives;
      s['KDRatio'] = n('SoloKill') / lives;
      s['ADRatio'] = n('Assists') / lives;
      s['PercentHeroDamage'] = pct('HeroDamage', 'HeroDamage');
      s['PercentTeamfightHeroDamage'] = pct('HeroDamage', 'TeamfightHeroDamage');
      s['PercentSiegeDamage'] = pct('SiegeDamage', 'SiegeDamage');
      s['PercentStructureDamage'] = pct('StructureDamage', 'StructureDamage');
      s['PercentMinionDamage'] = pct('MinionDamage', 'MinionDamage');
      s['PercentCreepDamage'] = pct('CreepDamage', 'CreepDamage');
      s['PercentHealing'] = pct('Healing', 'Healing');
      s['PercentProtection'] = pct('ProtectionGivenToAllies', 'ProtectionGivenToAllies');
      s['PercentTeamfightHealing'] = pct('TeamfightHealingDone', 'TeamfightHealingDone');
      s['PercentDamageTaken'] = pct('DamageTaken', 'DamageTaken');
      s['PercentDamageSoaked'] = pct('DamageSoaked', 'DamageSoaked');
      s['PercentTeamfightDamageTaken'] = pct('TeamfightDamageTaken', 'TeamfightDamageTaken');
      s['PercentXPContribution'] = n('ExperienceContribution') / (n('MetaExperience') || 1);
      s['PercentGameSpentDead'] = n('TimeSpentDead') / (gameSeconds || 1);
      s['PercentTimeOnFire'] = n('OnFireTimeOnFire') / (gameSeconds || 1);
      s['PercentDamageHealed'] = n('Healing') / (sums.get('DamageTaken')![team] || 1);
      if (ctx.statSupport['PercentDamageHealed']?.support === 'flawed') {
        s['PercentDamageHealed'] = n('Healing') / (heroDamageAgainst[team] || 1);
      }
      for (const name of Object.keys(s)) {
        if (unsupported(name)) s[name] = null;
        else if (warriorsOnly(name) && p.role !== 'warrior') s[name] = null;
      }
    }

    return {
      playerStats: players.map((p) => ({
        ...ref(p),
        silenced: p.silenced,
        voiceSilenced: p.voiceSilenced,
        ...table.get(p.slot)!,
      })),
      playerStatsSupport: [{ statSupport: ctx.statSupport }],
    };
  },
};
