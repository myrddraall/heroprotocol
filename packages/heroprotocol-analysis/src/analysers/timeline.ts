import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { all, int, NS, participants, str } from './shared.js';

export type TimelineEvent =
  | {
      readonly kind: 'alive';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: 'dead';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: 'death';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
      readonly killers: readonly number[];
      readonly x: number | null;
      readonly y: number | null;
    }
  | {
      readonly kind: 'level';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
      readonly level: number;
    }
  | {
      readonly kind: 'talent';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
      readonly talent: string;
      readonly level: number;
    }
  | {
      readonly kind: 'team-level';
      readonly team: Team;
      readonly start: number;
      readonly level: number;
    }
  | {
      readonly kind: 'structure-death';
      readonly team: Team | null;
      readonly start: number;
      readonly unitType: string;
      readonly townId: number | null;
      readonly killerSlot: number | null;
    }
  | {
      readonly kind: 'camp-capture';
      readonly team: Team | null;
      readonly start: number;
      readonly campId: number | null;
      readonly campType: string | null;
    }
  | {
      readonly kind: 'objective';
      readonly team: Team | null;
      readonly start: number;
      readonly name: string;
      readonly values: Readonly<Record<string, number | string>>;
    }
  | { readonly kind: 'core-death'; readonly team: Team | null; readonly start: number }
  | {
      readonly kind: 'left';
      readonly slot: number;
      readonly team: Team | null;
      readonly start: number;
    };

export interface Timeline {
  readonly durationLoops: number;
  /** Every event, by gameloop (`start`); lifespan segments also carry `end`. */
  readonly events: readonly TimelineEvent[];
}

/** Stat events that are neither player-level nor already represented, kept as generic map objectives. */
const NOT_OBJECTIVES = new Set([
  'GameStart',
  'PlayerInit',
  'TownStructureInit',
  'JungleCampInit',
  'PlayerSpawned',
  'LevelUp',
  'TalentChosen',
  'GatesOpen',
  'RegenGlobePickedUp',
  'PeriodicXPBreakdown',
  'PlayerDeath',
  'JungleCampCapture',
  'TownStructureDeath',
  'LootSprayUsed',
  'LootWheelUsed',
  'LootVoiceLineUsed',
  'EndOfGameXPBreakdown',
  'EndOfGameTimeSpentDead',
  'EndOfGameTalentChoices',
  'EndOfGameUpVotesCollected',
]);

/**
 * The game as a timeline: per-player alive/dead spans, deaths with killers, level-ups
 * and talent picks (the 2018 version emitted level-ups twice and talents never),
 * team levels, structure deaths, camp captures, map objectives and the core's death.
 */
export const timeline: Analyser<Timeline> = {
  id: `${NS}timeline`,
  version: 1,
  inputs: ['players', 'statEvents', 'units', 'events'],
  mode: 'background',
  async run(ctx) {
    const [players, stats, units, left] = await Promise.all([
      participants(ctx),
      ctx.read('statEvents'),
      ctx.read('units', { unitClass: 'core' }),
      ctx.read('events', { kind: 'PlayerLeft' }),
    ]);
    const teamOf = new Map(players.map((p) => [p.slot, p.team]));
    const events: TimelineEvent[] = [];
    const duration = ctx.replay.durationLoops;

    // lifespans: alive from spawn, dead from death to the next revive
    const spawns = stats.filter((e) => e.eventName === 'PlayerSpawned');
    const deaths = stats.filter((e) => e.eventName === 'PlayerDeath');
    const revives = (await ctx.read('events', { kind: 'UnitRevived' })).filter(
      (e) => e.playerSlot !== null,
    );
    for (const p of players) {
      const marks = [
        ...spawns
          .filter((e) => e.playerSlot === p.slot)
          .map((e) => ({ loop: e.gameloop, alive: true })),
        ...deaths
          .filter((e) => e.playerSlot === p.slot)
          .map((e) => ({ loop: e.gameloop, alive: false })),
        ...revives
          .filter((e) => e.playerSlot === p.slot)
          .map((e) => ({ loop: e.gameloop, alive: true })),
      ].sort((a, b) => a.loop - b.loop);
      let state: { alive: boolean; start: number } | null = null;
      for (const m of marks) {
        if (state && state.alive === m.alive) continue;
        if (state)
          events.push({
            kind: state.alive ? 'alive' : 'dead',
            slot: p.slot,
            team: p.team,
            start: state.start,
            end: m.loop,
          });
        state = { alive: m.alive, start: state ? m.loop : 0 };
      }
      if (state)
        events.push({
          kind: state.alive ? 'alive' : 'dead',
          slot: p.slot,
          team: p.team,
          start: state.start,
          end: duration,
        });
    }

    for (const e of stats) {
      const slot = e.playerSlot;
      switch (e.eventName) {
        case 'PlayerDeath':
          if (slot !== null)
            events.push({
              kind: 'death',
              slot,
              team: teamOf.get(slot) ?? null,
              start: e.gameloop,
              killers: all(e, 'KillingPlayer').map(Number),
              x: int(e, 'PositionX'),
              y: int(e, 'PositionY'),
            });
          break;
        case 'LevelUp':
          if (slot !== null)
            events.push({
              kind: 'level',
              slot,
              team: teamOf.get(slot) ?? null,
              start: e.gameloop,
              level: int(e, 'Level') ?? 0,
            });
          break;
        case 'TalentChosen': {
          if (slot === null) break;
          const pick = players
            .find((p) => p.slot === slot)
            ?.talents.find((t) => t.gameloop === e.gameloop);
          events.push({
            kind: 'talent',
            slot,
            team: teamOf.get(slot) ?? null,
            start: e.gameloop,
            talent: str(e, 'PurchaseName') ?? '',
            level: pick?.level ?? 0,
          });
          break;
        }
        case 'PeriodicXPBreakdown':
          if (e.team !== null)
            events.push({
              kind: 'team-level',
              team: e.team,
              start: e.gameloop,
              level: int(e, 'TeamLevel') ?? 0,
            });
          break;
        case 'TownStructureDeath': {
          const killer = int(e, 'KillingPlayer');
          const killerSlot = killer !== null && killer >= 1 && killer <= 10 ? killer - 1 : null;
          events.push({
            kind: 'structure-death',
            team: killerSlot === null ? null : (teamOf.get(killerSlot) ?? null),
            start: e.gameloop,
            unitType: str(e, 'UnitType') ?? '',
            townId: int(e, 'TownID'),
            killerSlot,
          });
          break;
        }
        case 'JungleCampCapture':
          events.push({
            kind: 'camp-capture',
            team: e.team,
            start: e.gameloop,
            campId: int(e, 'CampID'),
            campType: str(e, 'CampType'),
          });
          break;
        default:
          if (!NOT_OBJECTIVES.has(e.eventName))
            events.push({
              kind: 'objective',
              team: e.team,
              start: e.gameloop,
              name: e.eventName,
              values: e.values,
            });
      }
    }
    for (const core of units)
      if (core.diedAtLoop !== null)
        events.push({ kind: 'core-death', team: core.ownerTeam, start: core.diedAtLoop });
    for (const e of left) {
      if (
        e.playerSlot !== null &&
        (e.data['reason'] as number) !== 0 &&
        e.gameloop > 0 &&
        e.gameloop < duration
      ) {
        events.push({ kind: 'left', slot: e.playerSlot, team: e.team, start: e.gameloop });
      }
    }
    events.sort((a, b) => a.start - b.start);
    return { durationLoops: duration, events };
  },
};
