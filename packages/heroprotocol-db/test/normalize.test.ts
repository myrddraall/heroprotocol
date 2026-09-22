import { describe, expect, it } from 'vitest';
import type {
  ParsedReplay,
  RawEvent,
  SScoreResultEvent,
  SStatGameEvent,
} from '@myrddraall/heroprotocol';
import { unitTag } from '@myrddraall/heroprotocol';
import { gameModeOf } from '../src/normalize/gameMode.js';
import { PlayerLookup } from '../src/normalize/lookup.js';
import { normalizeScores } from '../src/normalize/score.js';
import { normalizeStatEvent } from '../src/normalize/stats.js';
import { classifyUnit, normalizeUnits } from '../src/normalize/units.js';
import { normalizeGameEvents } from '../src/normalize/gameEvents.js';
import { normalizeMessageEvents } from '../src/normalize/chat.js';
import { filetimeToIso, ticksToHours } from '../src/normalize/time.js';

const twoTeams = new PlayerLookup({
  header: { m_elapsedGameLoops: 1000 },
  details: {
    m_playerList: Array.from({ length: 10 }, (_, i) => ({
      m_workingSetSlotId: i,
      m_teamId: i < 5 ? 0 : 1,
      m_control: 2,
    })),
  },
  trackerEvents: [],
} as unknown as ParsedReplay);

const ev = (
  event: string,
  gameloop: number,
  fields: Record<string, unknown>,
  userId?: number,
): RawEvent =>
  ({
    _event: event,
    _eventid: 0,
    _gameloop: gameloop,
    _bits: 0,
    ...(userId === undefined ? {} : { _userid: { m_userId: userId } }),
    ...fields,
  }) as RawEvent;

describe('time', () => {
  it('converts FILETIME and offsets', () => {
    expect(filetimeToIso(131765264972519790)).toBe('2018-07-20T02:14:57.251Z');
    expect(ticksToHours(-252000000000)).toBe(-7);
  });
});

describe('gameModeOf', () => {
  it('maps matchmaking ids and falls back to the lobby options', () => {
    const opts = (o: Record<string, unknown>) =>
      ({
        m_ammId: 0,
        m_competitive: false,
        m_cooperative: false,
        m_heroDuplicatesAllowed: false,
        m_practice: false,
        ...o,
      }) as never;
    expect(gameModeOf(opts({ m_ammId: 50051 }))).toBe('unranked-draft');
    expect(gameModeOf(opts({ m_ammId: 50101 }))).toBe('aram');
    expect(gameModeOf(opts({ m_ammId: 50091 }))).toBe('storm-league');
    expect(gameModeOf(opts({ m_heroDuplicatesAllowed: true }))).toBe('custom');
    expect(gameModeOf(opts({}))).toBe('custom-draft');
    expect(gameModeOf(opts({ m_competitive: true }))).toBe('unknown');
    expect(gameModeOf(undefined)).toBe('unknown');
  });
});

describe('normalizeStatEvent', () => {
  it('flattens the three value lists, divides fixed point, resolves player and team, and collects repeats', () => {
    const e = ev('NNet.Replay.Tracker.SStatGameEvent', 1615, {
      m_eventName: 'PlayerDeath',
      m_stringData: null,
      m_intData: [
        { m_key: 'PlayerID', m_value: 6 },
        { m_key: 'KillingPlayer', m_value: 1 },
        { m_key: 'KillingPlayer', m_value: 3 },
      ],
      m_fixedData: [{ m_key: 'PositionX', m_value: 4096 * 128.5 }],
    }) as SStatGameEvent;
    const r = normalizeStatEvent('r', e, twoTeams);
    expect(r).toEqual({
      replayId: 'r',
      seq: 0,
      gameloop: 1615,
      seconds: 100.9375,
      eventName: 'PlayerDeath',
      playerSlot: 5,
      team: 1,
      values: { PlayerID: 6, PositionX: 128.5 },
      lists: { KillingPlayer: [1, 3] },
    });
  });

  it('reads 1-based team values', () => {
    const e = ev('NNet.Replay.Tracker.SStatGameEvent', 10, {
      m_eventName: 'PeriodicXPBreakdown',
      m_stringData: [],
      m_intData: [{ m_key: 'Team', m_value: 2 }],
      m_fixedData: [],
    }) as SStatGameEvent;
    const r = normalizeStatEvent('r', e, twoTeams);
    expect(r.team).toBe(1);
    expect(r.playerSlot).toBeNull();
    expect(r.lists).toBeUndefined();
  });
});

describe('normalizeScores', () => {
  const score = (gameloop: number, takedowns: number[], mvpSlot = 0): SScoreResultEvent =>
    ev('NNet.Replay.Tracker.SScoreResultEvent', gameloop, {
      m_instanceList: [
        { m_name: 'Takedowns', m_values: takedowns.map((v) => [{ m_value: v, m_time: gameloop }]) },
        { m_name: 'Level', m_values: takedowns.map(() => [{ m_value: 20, m_time: gameloop }]) },
        {
          m_name: 'EndOfMatchAwardMVPBoolean',
          m_values: takedowns.map((_, i) => [{ m_value: i === mvpSlot ? 1 : 0, m_time: gameloop }]),
        },
      ],
    }) as SScoreResultEvent;

  it('keeps the last event as the score screen, strips awards out of stats, and dedupes snapshots', () => {
    const zeros = Array.from({ length: 10 }, () => 0);
    const r = normalizeScores(
      'r',
      [
        score(0, zeros),
        score(0, zeros),
        score(0, zeros),
        score(
          500,
          zeros.map((_, i) => i),
        ),
        score(
          900,
          zeros.map((_, i) => i * 2),
          3,
        ),
      ],
      twoTeams,
    );
    expect(r.finalLoop).toBe(900);
    expect(r.results).toHaveLength(10);
    expect(r.results[3]).toEqual({
      replayId: 'r',
      slot: 3,
      team: 0,
      gameloop: 900,
      stats: { Takedowns: 6, Level: 20 },
      awards: ['MVP'],
    });
    expect(r.results[0]!.awards).toEqual([]);
    expect(r.snapshots.map((s) => s.gameloop)).toEqual([0, 500]); // the three loop-0 duplicates collapse
    expect(r.snapshots[1]!.kind).toBe('ScoreSnapshot');
    expect(
      (r.snapshots[1]!.data['scores'] as Record<number, Record<string, number>>)[9]!['Takedowns'],
    ).toBe(9);
  });

  it('returns nothing for a replay without a score screen', () => {
    expect(normalizeScores('r', [], twoTeams)).toEqual({
      finalLoop: null,
      results: [],
      snapshots: [],
    });
  });
});

describe('units', () => {
  it('classifies by name and owner', () => {
    expect(classifyUnit('HeroGenji', 1)).toBe('hero');
    expect(classifyUnit('FootmanMinion', 11)).toBe('minion');
    expect(classifyUnit('MercGoblinSapperLaner', 12)).toBe('mercenary');
    expect(classifyUnit('TownCannonTowerL2', 11)).toBe('structure');
    expect(classifyUnit('KingsCore', 12)).toBe('core');
    expect(classifyUnit('RegenGlobeNeutral', 0)).toBe('globe');
    expect(classifyUnit('WitchDoctorZombieWallUnit', 6)).toBe('summon');
    expect(classifyUnit('StormGameStartPathingBlocker', 0)).toBe('other');
  });

  it('merges born, type/owner changes, death and revive into one row per tag', () => {
    const tracker: RawEvent[] = [
      ev('NNet.Replay.Tracker.SUnitBornEvent', 10, {
        m_unitTagIndex: 5,
        m_unitTagRecycle: 1,
        m_unitTypeName: 'HeroGenji',
        m_controlPlayerId: 1,
        m_upkeepPlayerId: 1,
        m_x: 10,
        m_y: 20,
      }),
      ev('NNet.Replay.Tracker.SUnitBornEvent', 12, {
        m_unitTagIndex: 6,
        m_unitTagRecycle: 1,
        m_unitTypeName: 'MercLanerSiegeGiant',
        m_controlPlayerId: 0,
        m_upkeepPlayerId: 0,
        m_x: 1,
        m_y: 1,
      }),
      ev('NNet.Replay.Tracker.SUnitOwnerChangeEvent', 50, {
        m_unitTagIndex: 6,
        m_unitTagRecycle: 1,
        m_controlPlayerId: 12,
        m_upkeepPlayerId: 12,
      }),
      ev('NNet.Replay.Tracker.SUnitTypeChangeEvent', 60, {
        m_unitTagIndex: 6,
        m_unitTagRecycle: 1,
        m_unitTypeName: 'MercDefenderSiegeGiant',
      }),
      ev('NNet.Replay.Tracker.SUnitDiedEvent', 100, {
        m_unitTagIndex: 5,
        m_unitTagRecycle: 1,
        m_killerPlayerId: 7,
        m_x: 11,
        m_y: 21,
        m_killerUnitTagIndex: 9,
        m_killerUnitTagRecycle: 1,
      }),
      ev('NNet.Replay.Tracker.SUnitRevivedEvent', 200, {
        m_unitTagIndex: 5,
        m_unitTagRecycle: 1,
        m_x: 0,
        m_y: 0,
      }),
      ev('NNet.Replay.Tracker.SUnitDiedEvent', 300, {
        m_unitTagIndex: 6,
        m_unitTagRecycle: 1,
        m_killerPlayerId: 2,
        m_x: 5,
        m_y: 5,
        m_killerUnitTagIndex: null,
        m_killerUnitTagRecycle: null,
      }),
    ];
    const { units, events } = normalizeUnits('r', tracker, twoTeams);
    expect(units).toHaveLength(2);
    const hero = units.find((u) => u.tag === unitTag(5, 1))!;
    expect(hero).toMatchObject({
      type: 'HeroGenji',
      bornType: null,
      unitClass: 'hero',
      ownerSlot: 0,
      ownerTeam: 0,
      bornAtLoop: 10,
      bornAt: { x: 10, y: 20 },
      diedAtLoop: null,
      killerSlot: null,
      revived: 1,
    });
    const merc = units.find((u) => u.tag === unitTag(6, 1))!;
    expect(merc).toMatchObject({
      type: 'MercDefenderSiegeGiant',
      bornType: 'MercLanerSiegeGiant',
      unitClass: 'mercenary',
      ownerSlot: null,
      ownerTeam: 1,
      diedAtLoop: 300,
      killerSlot: 1,
      killerTeam: 0,
      typeChanges: [{ gameloop: 60, type: 'MercDefenderSiegeGiant' }],
      ownerChanges: [{ gameloop: 50, slot: null, team: 1 }],
    });
    expect(events.map((e) => e.kind)).toEqual([
      'UnitOwnerChanged',
      'UnitTypeChanged',
      'UnitRevived',
    ]);
  });
});

describe('game and message events', () => {
  it('cleans commands, keeps the long tail as kinds, drops model noise, and detects leavers', () => {
    const game: RawEvent[] = [
      ev('NNet.Game.SUserFinishedLoadingSyncEvent', 0, {}, 16),
      ev('NNet.Game.STriggerChatMessageEvent', 5, { m_chatMessage: 'dup' }, 1),
      ev(
        'NNet.Game.SCmdEvent',
        76,
        {
          m_cmdFlags: 1,
          m_abil: { m_abilLink: 27, m_abilCmdIndex: 0, m_abilCmdData: null },
          m_data: { TargetPoint: { x: 4096 * 2, y: 4096 * 3, z: 0 } },
          m_sequence: 1,
          m_otherUnit: null,
          m_unitGroup: null,
        },
        7,
      ),
      ev(
        'NNet.Game.SCmdEvent',
        80,
        {
          m_cmdFlags: 2,
          m_abil: null,
          m_data: { TargetUnit: { m_tag: 99, m_snapshotPoint: { x: 4096, y: 4096, z: 0 } } },
          m_sequence: 2,
          m_otherUnit: 5,
          m_unitGroup: null,
        },
        7,
      ),
      ev(
        'NNet.Game.SCmdEvent',
        81,
        {
          m_cmdFlags: 2,
          m_abil: null,
          m_data: { None: null },
          m_sequence: 3,
          m_otherUnit: null,
          m_unitGroup: null,
        },
        7,
      ),
      ev('NNet.Game.SHeroTalentTreeSelectedEvent', 86, { m_index: 2 }, 2),
      ev(
        'NNet.Game.STriggerPingEvent',
        949,
        { m_point: { x: 4096, y: 8192 }, m_unit: 0, m_pingedMinimap: false, m_option: 0 },
        2,
      ),
      ev('NNet.Game.SUnitClickEvent', 288, { m_unitTag: 42 }, 0),
      ev('NNet.Game.SGameUserLeaveEvent', 0, { m_leaveReason: 11 }, 9),
      ev(
        'NNet.Game.SGameUserJoinEvent',
        0,
        { m_name: 'x', m_toonHandle: '', m_clanTag: '', m_observe: 0, m_hijack: false },
        9,
      ),
      ev('NNet.Game.SGameUserLeaveEvent', 500, { m_leaveReason: 11 }, 9),
      ev('NNet.Game.SGameUserLeaveEvent', 1000, { m_leaveReason: 0 }, 3),
    ];
    const r = normalizeGameEvents('r', game, twoTeams, 1000);
    expect(r.commands).toHaveLength(3);
    expect(r.commands[0]).toEqual({
      replayId: 'r',
      seq: 0,
      gameloop: 76,
      seconds: 4.75,
      playerSlot: 7,
      abilLink: 27,
      abilCmdIndex: 0,
      flags: 1,
      targetKind: 'point',
      targetPoint: { x: 2, y: 3 },
      targetUnitTag: null,
      otherUnitTag: null,
      sequence: 1,
    });
    expect(r.commands[1]).toMatchObject({
      targetKind: 'unit',
      targetUnitTag: 99,
      targetPoint: { x: 1, y: 1 },
      otherUnitTag: 5,
      abilLink: null,
    });
    expect(r.commands[2]).toMatchObject({ targetKind: 'none', targetPoint: null });
    expect(r.events.map((e) => e.kind)).toEqual([
      'TalentTreeSelected',
      'Ping',
      'UnitClick',
      'PlayerLeft',
      'PlayerJoined',
      'PlayerLeft',
      'PlayerLeft',
    ]);
    expect(r.events[1]!.data).toEqual({
      point: { x: 1, y: 2 },
      unitTag: 0,
      minimap: false,
      option: 0,
    });
    // slot 9 left at 500 and never came back; slot 3 left at end of game (reason 0)
    expect([...r.leftAt]).toEqual([[9, 500]]);
  });

  it('turns chat and pings into chat rows and reconnects into events', () => {
    const messages: RawEvent[] = [
      ev('NNet.Game.SLoadingProgressMessage', 0, { m_progress: 1 }, 1),
      ev('NNet.Game.SChatMessage', 9035, { m_recipient: 0, m_string: 'gg' }, 5),
      ev('NNet.Game.SPingMessage', 2628, { m_recipient: 1, m_point: { x: 4096, y: 4096 } }, 5),
      ev('NNet.Game.SReconnectNotifyMessage', 3000, { m_status: 1 }, 9),
    ];
    const r = normalizeMessageEvents('r', messages, twoTeams);
    expect(r.chat).toEqual([
      {
        replayId: 'r',
        seq: 0,
        gameloop: 9035,
        seconds: 564.6875,
        playerSlot: 5,
        kind: 'chat',
        recipient: 'all',
        text: 'gg',
        point: null,
      },
      {
        replayId: 'r',
        seq: 0,
        gameloop: 2628,
        seconds: 164.25,
        playerSlot: 5,
        kind: 'ping',
        recipient: 'allies',
        text: null,
        point: { x: 1, y: 1 },
      },
    ]);
    expect(r.events).toEqual([
      {
        replayId: 'r',
        seq: 0,
        gameloop: 3000,
        seconds: 187.5,
        playerSlot: 9,
        team: 1,
        kind: 'Reconnect',
        data: { status: 1 },
      },
    ]);
  });
});
