import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import {
  analyse,
  createReplayDb,
  createRegistry,
  createWorker,
  HeroDb,
  type NormalizedReplay,
  type WorkerLike,
  type WorkerScope,
} from '@myrddraall/heroprotocol-db';
import { builtins } from '../src/builtins.js';
import { builtinTables, createBuiltinRegistry } from '../src/index.js';
import type { DescriptionPlayerRow, DescriptionRow } from '../src/analysers/description.js';
import type { ScoreScreenPlayerRow, ScoreScreenTeamRow } from '../src/analysers/scoreScreen.js';
import type { PlayerStatsRow, PlayerStatsSupportRow } from '../src/analysers/playerStats.js';
import type { DraftRow, DraftStepRow } from '../src/analysers/draft.js';
import type { TimelineEventRow } from '../src/analysers/timeline.js';
import type { XpPointRow } from '../src/analysers/xpCurve.js';
import type { PlayerKillsRow, TeamKillsRow } from '../src/analysers/unitKills.js';
import type { ChatLineRow } from '../src/analysers/chat.js';
import type { CommandStatsRow } from '../src/analysers/commands.js';
import type { DeathHeatmapCellRow, DeathHeatmapRow } from '../src/analysers/deathHeatmap.js';
import type { PointOfInterestRow } from '../src/analysers/pointsOfInterest.js';
import type { TalentPickRow } from '../src/analysers/talents.js';
import { goldenFor, localReplays, normalizeLocal, readLocal, stable } from './util.js';
import { runFromStore, runInMemory } from './run.js';

const replays = localReplays();
const fixtures = new Map<string, NormalizedReplay>();
const dbs: HeroDb[] = [];
let n = 0;

beforeAll(async () => {
  for (const f of replays) fixtures.set(f, await normalizeLocal(f));
});
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});

describe('registry', () => {
  it('registers every built-in with a valid dependency graph and unique replayId-first tables, in viewer order', () => {
    const reg = createBuiltinRegistry();
    expect(() => reg.validate()).not.toThrow();
    expect(reg.list('ready').map((r) => r.analyser.id)).toEqual([
      '@myrddraall/description',
      '@myrddraall/score-screen',
      '@myrddraall/unit-kills',
      '@myrddraall/player-stats',
      '@myrddraall/draft',
    ]);
    expect(reg.list('background').map((r) => r.analyser.id)).toEqual([
      '@myrddraall/talents',
      '@myrddraall/xp-curve',
      '@myrddraall/timeline',
      '@myrddraall/points-of-interest',
      '@myrddraall/chat',
    ]);
    expect(reg.list('lazy').map((r) => r.analyser.id)).toEqual([
      '@myrddraall/commands',
      '@myrddraall/death-heatmap',
    ]);
    const tables = builtinTables();
    expect(Object.keys(tables).sort()).toEqual([
      'abilityUses',
      'chatLines',
      'commandStats',
      'deathHeatmapCells',
      'deathHeatmaps',
      'description',
      'descriptionPlayers',
      'draft',
      'draftSteps',
      'mapInfo',
      'playerStats',
      'playerStatsSupport',
      'pointsOfInterest',
      'scoreScreenPlayers',
      'scoreScreenTeams',
      'talentPicks',
      'teamUnitKills',
      'timelineEvents',
      'unitKills',
      'xpPoints',
    ]);
    expect(builtins.every((a) => a.id.startsWith('@myrddraall/') && a.version >= 2)).toBe(true);
  });
});

describe.skipIf(replays.length === 0)('built-in analysers on real replays', () => {
  describe.each(replays)('%s', (file) => {
    it('produce identical rows at ingest (memory) and lazily (store)', async () => {
      const f = fixtures.get(file)!;
      const mem = await runInMemory(f);
      const { results, db } = await runFromStore(f, `analysis-${n++}`);
      dbs.push(db);
      expect(Object.keys(results).sort()).toEqual(Object.keys(mem).sort());
      for (const id of Object.keys(mem)) expect(stable(results[id]), id).toEqual(stable(mem[id]));
      // and the store holds exactly those rows, queryable through the analysers' indexes
      expect(
        await db
          .table('scoreScreenPlayers')
          .where('[replayId+slot]')
          .equals([f.replay.id, 0])
          .count(),
      ).toBe(1);
      expect(
        await db
          .table('timelineEvents')
          .where('[replayId+kind]')
          .equals([f.replay.id, 'death'])
          .count(),
      ).toBe(f.statEvents.filter((s) => s.eventName === 'PlayerDeath').length);
      expect(
        await db.table('scoreScreenPlayers').where('awards').equals('MVP').count(),
      ).toBeLessThanOrEqual(1);
    });

    it('match the committed golden', async () => {
      const golden = goldenFor(file);
      expect(
        golden,
        'no golden committed — run `pnpm run generate.analysis-goldens`',
      ).toBeDefined();
      expect(stable(await runInMemory(fixtures.get(file)!))).toEqual(golden);
    });

    it('hold the invariants the 2018 viewer relied on, without its bugs', async () => {
      const f = fixtures.get(file)!;
      const r = await runInMemory(f);
      const t = <T>(id: string, table: string): T[] => r[id]![table] as T[];
      const [description] = t<DescriptionRow>('@myrddraall/description', 'description');
      const descPlayers = t<DescriptionPlayerRow>('@myrddraall/description', 'descriptionPlayers');
      const scorePlayers = t<ScoreScreenPlayerRow>(
        '@myrddraall/score-screen',
        'scoreScreenPlayers',
      );
      const scoreTeams = t<ScoreScreenTeamRow>('@myrddraall/score-screen', 'scoreScreenTeams');
      const stats = t<PlayerStatsRow>('@myrddraall/player-stats', 'playerStats');
      const [support] = t<PlayerStatsSupportRow>('@myrddraall/player-stats', 'playerStatsSupport');
      const [draft] = t<DraftRow>('@myrddraall/draft', 'draft');
      const steps = t<DraftStepRow>('@myrddraall/draft', 'draftSteps');
      const tl = t<TimelineEventRow>('@myrddraall/timeline', 'timelineEvents');
      const xp = t<XpPointRow>('@myrddraall/xp-curve', 'xpPoints');
      const kills = t<PlayerKillsRow>('@myrddraall/unit-kills', 'unitKills');
      const teamKills = t<TeamKillsRow>('@myrddraall/unit-kills', 'teamUnitKills');
      const chat = t<ChatLineRow>('@myrddraall/chat', 'chatLines');
      const cmds = t<CommandStatsRow>('@myrddraall/commands', 'commandStats');
      const [heat] = t<DeathHeatmapRow>('@myrddraall/death-heatmap#-', 'deathHeatmaps');
      const cells = t<DeathHeatmapCellRow>('@myrddraall/death-heatmap#-', 'deathHeatmapCells');
      const poi = t<PointOfInterestRow>('@myrddraall/points-of-interest', 'pointsOfInterest');
      const talents = t<TalentPickRow>('@myrddraall/talents', 'talentPicks');

      // description: one replay row, ten participants, the winner is consistent
      expect(description!.playerCount).toBe(10);
      expect(descPlayers).toHaveLength(10);
      expect(
        descPlayers.filter((p) => p.won).every((p) => p.team === description!.winningTeam),
      ).toBe(true);
      expect(description!.durationSeconds).toBe(f.replay.durationSeconds);

      // score screen: each team's kills are the other team's deaths, winner flagged, stats are columns
      const deaths = (team: 0 | 1) =>
        scorePlayers.filter((p) => p.team === team).reduce((a, p) => a + (p.Deaths ?? 0), 0);
      expect(scoreTeams.find((x) => x.team === 0)!.kills).toBe(deaths(1));
      expect(scoreTeams.find((x) => x.team === 1)!.kills).toBe(deaths(0));
      expect(scoreTeams.filter((x) => x.won)).toHaveLength(1);
      expect(scorePlayers.every((p) => p.Takedowns !== null)).toBe(true);
      expect(scorePlayers.filter((p) => p.mvp).length).toBeLessThanOrEqual(1);

      // player stats: derived columns present, no award booleans, recomputed solo kills ≤ takedowns
      for (const p of stats) {
        expect(Object.keys(p).some((k) => k.endsWith('Boolean'))).toBe(false);
        expect(p['KillParticipation']).toBeGreaterThanOrEqual(0);
        expect(p['KillParticipation']).toBeLessThanOrEqual(1);
        expect(p['SoloKill'] as number).toBeLessThanOrEqual(p['Takedowns'] as number);
        expect(p['MinionsKilled']).toBe(kills.find((k) => k.slot === p.slot)!.minions);
        expect(p['RegenGlobesCollected']).toBeGreaterThanOrEqual(0);
        expect(p['TimeDisconnected']).toBeGreaterThanOrEqual(0);
        expect(p['Reconnects']).toBeGreaterThanOrEqual(0);
      }
      expect(support!.statSupport).toEqual({});
      const leaver = descPlayers.find((p) => p.leftAtSeconds !== null);
      if (leaver)
        expect(stats.find((p) => p.slot === leaver.slot)!['TimeDisconnected']).toBeGreaterThan(0);

      // draft: steps in real order, picks name real players
      expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i + 1));
      for (let i = 1; i < steps.length; i++)
        expect(steps[i]!.gameloop).toBeGreaterThanOrEqual(steps[i - 1]!.gameloop);
      expect(
        steps.filter((s) => s.type === 'pick').every((p) => p.slot !== null && p.name !== null),
      ).toBe(true);
      if (draft!.picking === 'draft') expect(draft!.bans).toBeGreaterThan(0);

      // timeline: level events once each with numeric levels, talents with names, spans tile the game
      const levels = tl.filter((e) => e.kind === 'level');
      expect(levels).toHaveLength(f.statEvents.filter((s) => s.eventName === 'LevelUp').length);
      expect(levels.every((e) => (e.level ?? 0) > 0)).toBe(true);
      const talentEvents = tl.filter((e) => e.kind === 'talent');
      expect(talentEvents.length).toBe(f.players.reduce((a, p) => a + p.talents.length, 0));
      expect(talentEvents.every((e) => (e.talent ?? '').length > 0 && (e.level ?? 0) > 0)).toBe(
        true,
      );
      for (const p of descPlayers) {
        const spans = tl.filter(
          (e) => (e.kind === 'alive' || e.kind === 'dead') && e.slot === p.slot,
        );
        expect(spans[0]!.start).toBe(0);
        expect(spans.at(-1)!.end).toBe(f.replay.durationLoops);
        for (let i = 1; i < spans.length; i++) expect(spans[i]!.start).toBe(spans[i - 1]!.end);
      }
      expect(tl.filter((e) => e.kind === 'core-death')).toHaveLength(1);
      for (let i = 1; i < tl.length; i++)
        expect(tl[i]!.start).toBeGreaterThanOrEqual(tl[i - 1]!.start);
      expect(tl.map((e) => e.seq)).toEqual(tl.map((_, i) => i));

      // xp curve: per team, monotonic time and cumulative, ends at the final score
      for (const team of [0, 1] as const) {
        const points = xp.filter((p) => p.team === team);
        expect(points.length).toBeGreaterThan(2);
        for (let i = 1; i < points.length; i++) {
          expect(points[i]!.seq).toBe(i);
          expect(points[i]!.seconds).toBeGreaterThanOrEqual(points[i - 1]!.seconds);
          expect(points[i]!.cumulative).toBeGreaterThanOrEqual(points[i - 1]!.cumulative);
        }
        expect(points.at(-1)!.seconds).toBe(
          (f.replay.finalScoreLoop ?? f.replay.durationLoops) / 16,
        );
      }

      // unit kills: totals add up
      for (const k of kills) {
        expect(k.total).toBe(
          k.minions +
            k.mercsCamp +
            k.mercsLane +
            k.bossCamp +
            k.bossLane +
            k.structures +
            k.heroes +
            k.summons +
            k.other,
        );
      }
      expect(teamKills.reduce((a, x) => a + x.total, 0)).toBe(
        kills.reduce((a, k) => a + k.total, 0),
      );

      // chat is joined with players
      expect(chat.length).toBe(f.chat.length);
      expect(
        chat.filter((c) => c.kind === 'chat').every((c) => c.name !== null && c.name.length > 0),
      ).toBe(true);

      // commands: per-minute buckets sum to the total, APM positive, ability uses sum to casts
      const uses = r['@myrddraall/commands']!['abilityUses'] as { slot: number; count: number }[];
      for (const p of cmds) {
        expect(p.perMinute.reduce((a, b) => a + b, 0)).toBe(p.commands);
        expect(p.casts + p.moves).toBe(p.commands);
        expect(p.apm).toBeGreaterThan(0);
        expect(uses.filter((u) => u.slot === p.slot).reduce((a, u) => a + u.count, 0)).toBe(
          p.casts,
        );
      }
      expect(cmds.reduce((a, p) => a + p.commands, 0)).toBe(f.commands.length);

      // heatmap covers every death; POIs include the two cores; talents are tiered in order
      expect(heat!.total).toBe(f.statEvents.filter((s) => s.eventName === 'PlayerDeath').length);
      expect(cells.reduce((a, c) => a + c.count, 0)).toBe(heat!.total);
      expect(heat!.mapWidth).not.toBeNull();
      expect(poi.filter((p) => p.type === 'core')).toHaveLength(2);
      for (const p of descPlayers) {
        const mine = talents.filter((x) => x.slot === p.slot);
        expect(mine.map((x) => x.tier)).toEqual(mine.map((_, i) => i + 1));
      }
    });
  });

  it('lazy flow end to end: absent → analyse() streams status → liveQuery on the table fires → second call is cached; version bump recomputes; mode override at registration', async () => {
    const file = replays[0]!;
    const { scope, worker } = (() => {
      const ch = new MessageChannel();
      return {
        scope: ch.port1 as unknown as WorkerScope,
        worker: ch.port2 as unknown as WorkerLike,
      };
    })();
    const handle = createWorker(
      {
        analysers: builtins.map((a) =>
          a.id === '@myrddraall/commands'
            ? { analyser: a, options: { mode: 'background' as const } }
            : a,
        ),
      },
      scope,
    );
    const client = createReplayDb({ dbName: `analysis-lazy-${n++}`, worker });
    const info = await client.ready;
    dbs.push(client.db);
    expect(info.analysers.find((a) => a.id === '@myrddraall/commands')?.mode).toBe('background');
    expect(info.analysers.find((a) => a.id === '@myrddraall/death-heatmap')?.mode).toBe('lazy');
    expect(Object.keys(info.tables)).toContain('deathHeatmapCells');

    const { replayId } = await client.ingest(readLocal(file), { fileName: file }).complete;
    expect(await client.db.table('commandStats').where('replayId').equals(replayId).count()).toBe(
      10,
    ); // ran in the background now
    expect(await client.db.table('deathHeatmaps').where('replayId').equals(replayId).count()).toBe(
      0,
    );

    const seen: unknown[][] = [];
    const sub = liveQuery(() =>
      client.db.table('deathHeatmaps').where('replayId').equals(replayId).toArray(),
    ).subscribe((rows) => seen.push(rows));
    await new Promise((r) => setTimeout(r, 20));
    const states: string[] = [];
    const first = await client.analyse(replayId, '@myrddraall/death-heatmap', {
      params: { team: 1 },
      onStatus: (s) => states.push(s.state),
    });
    expect(states).toEqual(['running', 'done']);
    expect((first.rows['deathHeatmaps']![0] as DeathHeatmapRow).total).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toHaveLength(1);
    sub.unsubscribe();

    const second = await client.analyse(replayId, '@myrddraall/death-heatmap', {
      params: { team: 1 },
      onStatus: (s) => states.push(s.state),
    });
    expect(states.at(-1)).toBe('cached');
    expect(second.run).toEqual(first.run);
    // rows read back from a table come in primary-key order
    const sorted = (rows: readonly object[]) =>
      [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    for (const table of Object.keys(first.rows))
      expect(sorted(second.rows[table]!), table).toEqual(sorted(first.rows[table]!));

    const bumped = createRegistry(
      builtins.map((a) =>
        a.id === '@myrddraall/death-heatmap' ? { ...a, version: a.version + 1 } : a,
      ),
    );
    const recomputed = await analyse(client.db, replayId, '@myrddraall/death-heatmap', {
      registry: bumped,
      params: { team: 1 },
    });
    expect(recomputed.run.analyserVersion).toBe(first.run.analyserVersion + 1);
    expect(await client.db.table('deathHeatmaps').where('replayId').equals(replayId).count()).toBe(
      1,
    ); // replaced, not duplicated

    await client.close();
    await handle.dispose();
  });
});
