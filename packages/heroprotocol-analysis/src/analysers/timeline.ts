import type { Analyser, Team } from '@myrddraall/heroprotocol-db';
import { all, int, NS, participants, str, withSeq } from './shared.js';

export type TimelineKind =
  | 'alive'
  | 'dead'
  | 'death'
  | 'level'
  | 'talent'
  | 'team-level'
  | 'structure-death'
  | 'camp-capture'
  | 'objective'
  | 'core-death'
  | 'left';

/**
 * One row per timeline event, by gameloop (`start`); lifespan spans (`alive`/`dead`)
 * also carry `end`. Kind-specific fields are null when they do not apply.
 */
export interface TimelineEventRow {
  readonly seq: number;
  readonly kind: TimelineKind;
  readonly start: number;
  readonly end: number | null;
  readonly slot: number | null;
  readonly team: Team | null;
  /** `level`, `talent`, `team-level` */
  readonly level: number | null;
  /** `talent` */
  readonly talent: string | null;
  /** `death`: PlayerIDs of the killers */
  readonly killers: readonly number[] | null;
  readonly x: number | null;
  readonly y: number | null;
  /** `structure-death` */
  readonly unitType: string | null;
  readonly townId: number | null;
  readonly killerSlot: number | null;
  /** `camp-capture` */
  readonly campId: number | null;
  readonly campType: string | null;
  /** `objective`: the stat event's name and values */
  readonly name: string | null;
  readonly values: Readonly<Record<string, number | string>> | null;
}

export type TimelineTables = {
  readonly timelineEvents: TimelineEventRow[];
};

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

type Draft = Omit<TimelineEventRow, 'seq'>;
const blank: Omit<Draft, 'kind' | 'start'> = {
  end: null,
  slot: null,
  team: null,
  level: null,
  talent: null,
  killers: null,
  x: null,
  y: null,
  unitType: null,
  townId: null,
  killerSlot: null,
  campId: null,
  campType: null,
  name: null,
  values: null,
};

/**
 * The game as a timeline: per-player alive/dead spans, deaths with killers, level-ups
 * and talent picks (the 2018 version emitted level-ups twice and talents never),
 * team levels, structure deaths, camp captures, map objectives, the core's death, leavers.
 */
export const timeline: Analyser<TimelineTables> = {
  id: `${NS}timeline`,
  version: 2,
  tables: { timelineEvents: '[replayId+seq], replayId, [replayId+kind], [replayId+slot], start' },
  inputs: ['players', 'statEvents', 'units', 'events'],
  mode: 'background',
  async run(ctx) {
    const [players, stats, cores, left, revives] = await Promise.all([
      participants(ctx),
      ctx.read('statEvents'),
      ctx.read('units', { unitClass: 'core' }),
      ctx.read('events', { kind: 'PlayerLeft' }),
      ctx.read('events', { kind: 'UnitRevived' }),
    ]);
    const teamOf = new Map(players.map((p) => [p.slot, p.team]));
    const events: Draft[] = [];
    const duration = ctx.replay.durationLoops;
    const push = (e: Partial<Draft> & Pick<Draft, 'kind' | 'start'>): void => {
      events.push({ ...blank, ...e });
    };

    const spawns = stats.filter((e) => e.eventName === 'PlayerSpawned');
    const deaths = stats.filter((e) => e.eventName === 'PlayerDeath');
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
          push({
            kind: state.alive ? 'alive' : 'dead',
            slot: p.slot,
            team: p.team,
            start: state.start,
            end: m.loop,
          });
        state = { alive: m.alive, start: state ? m.loop : 0 };
      }
      if (state)
        push({
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
            push({
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
            push({
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
          push({
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
            push({
              kind: 'team-level',
              team: e.team,
              start: e.gameloop,
              level: int(e, 'TeamLevel') ?? 0,
            });
          break;
        case 'TownStructureDeath': {
          const killer = int(e, 'KillingPlayer');
          const killerSlot = killer !== null && killer >= 1 && killer <= 10 ? killer - 1 : null;
          push({
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
          push({
            kind: 'camp-capture',
            team: e.team,
            start: e.gameloop,
            campId: int(e, 'CampID'),
            campType: str(e, 'CampType'),
          });
          break;
        default:
          if (!NOT_OBJECTIVES.has(e.eventName))
            push({
              kind: 'objective',
              team: e.team,
              start: e.gameloop,
              name: e.eventName,
              values: e.values,
            });
      }
    }
    for (const core of cores)
      if (core.diedAtLoop !== null)
        push({ kind: 'core-death', team: core.ownerTeam, start: core.diedAtLoop });
    for (const e of left) {
      if (
        e.playerSlot !== null &&
        (e.data['reason'] as number) !== 0 &&
        e.gameloop > 0 &&
        e.gameloop < duration
      ) {
        push({ kind: 'left', slot: e.playerSlot, team: e.team, start: e.gameloop });
      }
    }
    events.sort((a, b) => a.start - b.start);
    return { timelineEvents: withSeq(events) };
  },
};
