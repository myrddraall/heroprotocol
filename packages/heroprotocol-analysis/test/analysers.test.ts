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
import type { XpPointRow } from '../src/analysers/xpCurve.js';
import type { PlayerKillsRow, TeamKillsRow } from '../src/analysers/unitKills.js';
import type { ChatLineRow } from '../src/analysers/chat.js';
import type { CommandStatsRow } from '../src/analysers/commands.js';
import type { DeathHeatmapCellRow, DeathHeatmapRow } from '../src/analysers/deathHeatmap.js';
import type { TalentPickRow } from '../src/analysers/talents.js';
import type { TeamStatsRow } from '../src/analysers/teamStats.js';
import type { ActivityRow } from '../src/analysers/activity.js';
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
      '@myrddraall/team-stats',
      '@myrddraall/draft',
    ]);
    expect(reg.list('background').map((r) => r.analyser.id)).toEqual([
      '@myrddraall/talents',
      '@myrddraall/xp-curve',
      '@myrddraall/chat',
    ]);
    expect(reg.list('lazy').map((r) => r.analyser.id)).toEqual([
      '@myrddraall/commands',
      '@myrddraall/activity',
      '@myrddraall/death-heatmap',
    ]);
    const tables = builtinTables();
    expect(Object.keys(tables).sort()).toEqual([
      'abilityUses',
      'activity',
      'chatLines',
      'commandStats',
      'deathHeatmapCells',
      'deathHeatmaps',
      'description',
      'descriptionPlayers',
      'draft',
      'draftSteps',
      'playerStats',
      'playerStatsSupport',
      'scoreScreenPlayers',
      'scoreScreenTeams',
      'talentPicks',
      'teamStats',
      'teamUnitKills',
      'unitKills',
      'xpPoints',
    ]);
    // the analysers that predate owning their tables were bumped past 1; newer ones start at 1
    const NEW = ['@myrddraall/team-stats', '@myrddraall/activity'];
    expect(
      builtins.every(
        (a) => a.id.startsWith('@myrddraall/') && a.version >= (NEW.includes(a.id) ? 1 : 2),
      ),
    ).toBe(true);
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
      const xp = t<XpPointRow>('@myrddraall/xp-curve', 'xpPoints');
      const kills = t<PlayerKillsRow>('@myrddraall/unit-kills', 'unitKills');
      const teamKills = t<TeamKillsRow>('@myrddraall/unit-kills', 'teamUnitKills');
      const chat = t<ChatLineRow>('@myrddraall/chat', 'chatLines');
      const cmds = t<CommandStatsRow>('@myrddraall/commands', 'commandStats');
      const [heat] = t<DeathHeatmapRow>('@myrddraall/death-heatmap#-', 'deathHeatmaps');
      const cells = t<DeathHeatmapCellRow>('@myrddraall/death-heatmap#-', 'deathHeatmapCells');
      const talents = t<TalentPickRow>('@myrddraall/talents', 'talentPicks');
      const teams = t<TeamStatsRow>('@myrddraall/team-stats', 'teamStats');
      const active = t<ActivityRow>('@myrddraall/activity', 'activity');

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
        // one key per stat: the game's duplicates of ours are dropped
        expect(p).not.toHaveProperty('MinionKills');
        expect(p).not.toHaveProperty('RegenGlobes');
        expect(p['PercentTeamfightHeroDamage'] as number).toBeLessThanOrEqual(1);
        expect(p['RegenGlobesCollected']).toBeGreaterThanOrEqual(0);
        expect(p['TimeDisconnected']).toBeGreaterThanOrEqual(0);
        expect(p['Reconnects']).toBeGreaterThanOrEqual(0);
      }
      expect(support!.statSupport).toEqual({});
      const leaver = descPlayers.find((p) => p.leftAtSeconds !== null);
      if (leaver)
        expect(stats.find((p) => p.slot === leaver.slot)!['TimeDisconnected']).toBeGreaterThan(0);

      // player stats rates: per minute over the game's clock; hard + soft CC = total CC
      const minutes = f.replay.durationSeconds / 60;
      for (const p of stats) {
        const n = (k: string) => p[k] as number;
        expect(n('HeroDamagePerMinute')).toBeCloseTo(n('HeroDamage') / minutes, 6);
        expect(n('TakedownsPer10Minutes')).toBeCloseTo((n('Takedowns') / minutes) * 10, 6);
        expect(n('CCSecondsPerMinute')).toBeCloseTo(
          n('HardCCSecondsPerMinute') + n('SoftCCSecondsPerMinute'),
          6,
        );
        if (n('DamageTaken') > 0)
          expect(n('DamageRatio')).toBeCloseTo(n('HeroDamage') / n('DamageTaken'), 6);
      }

      // team stats: one row per team; kills match the score screen, KDA and averages from the sums,
      // XP sources add up to the curve's end, forts/keeps destroyed mirror the other team's lost,
      // a team's camps are at least any one player's credited captures
      expect(teams.map((x) => x.team)).toEqual([0, 1]);
      for (const x of teams) {
        const other = teams.find((o) => o.team !== x.team)!;
        const mine = stats.filter((p) => p.team === x.team);
        expect(x.kills).toBe(scoreTeams.find((s) => s.team === x.team)!.kills);
        expect(x.deaths).toBe(other.kills);
        expect(x.teamKDA).toBeCloseTo(x.kills / Math.max(x.deaths, 1), 9);
        expect(x.heroDamage).toBe(mine.reduce((a, p) => a + (p['HeroDamage'] as number), 0));
        expect(x.averageTimeDead).toBeCloseTo(x.timeDead! / mine.length, 9);
        expect(x.peoplePerKill).toBeGreaterThanOrEqual(1);
        expect(x.peoplePerKill).toBeLessThanOrEqual(5);
        expect(x.totalXP).toBeCloseTo(xp.filter((p) => p.team === x.team).at(-1)!.total, 6);
        expect(x.fortsDestroyed).toBe(other.fortsLost);
        expect(x.keepsDestroyed).toBe(other.keepsLost);
        expect(x.firstFortSeconds === null).toBe(x.fortsDestroyed === 0);
        expect(x.firstKeepSeconds === null).toBe(x.keepsDestroyed === 0);
        expect(x.campCaptures).toBe(x.campsSiege + x.campsBruiser + x.campsBoss + x.campsOther);
        expect(x.campCaptures).toBeGreaterThanOrEqual(
          Math.max(...mine.map((p) => p['MercCampCaptures'] as number)),
        );
        expect(x.firstCampSeconds === null).toBe(x.campCaptures === 0);
      }
      // the losing team's core died near the end; the winner's did not
      const loser = teams.find((x) => !x.won)!;
      if (loser.coreSeconds !== null)
        expect(loser.coreSeconds).toBeLessThanOrEqual(f.replay.durationSeconds);
      expect(teams.find((x) => x.won)!.coreSeconds).toBeNull();

      // activity: APM from commands; communication counts are within the replay's totals
      expect(active).toHaveLength(10);
      for (const a of active) {
        expect(a.apm).toBe(cmds.find((c) => c.slot === a.slot)!.apm);
        expect(a.minimapPings).toBeLessThanOrEqual(a.pings);
        expect(a.upvotesGiven).toBeLessThanOrEqual(1);
      }
      expect(active.reduce((a, x) => a + x.chatMessages, 0)).toBe(
        f.chat.filter((c) => c.kind === 'chat' && c.playerSlot !== null).length,
      );
      expect(active.reduce((a, x) => a + x.pings, 0)).toBeGreaterThan(0);

      // draft: steps in real order, picks name real players
      expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i + 1));
      for (let i = 1; i < steps.length; i++)
        expect(steps[i]!.gameloop).toBeGreaterThanOrEqual(steps[i - 1]!.gameloop);
      expect(
        steps.filter((s) => s.type === 'pick').every((p) => p.slot !== null && p.name !== null),
      ).toBe(true);
      if (draft!.picking === 'draft') expect(draft!.bans).toBeGreaterThan(0);

      // xp curve: per team, running totals over the game's clock, what was gained between
      // points adding up to the total, ending at the final score
      for (const team of [0, 1] as const) {
        const points = xp.filter((p) => p.team === team);
        expect(points.length).toBeGreaterThan(2);
        for (let i = 1; i < points.length; i++) {
          expect(points[i]!.seq).toBe(i);
          expect(points[i]!.seconds).toBeGreaterThanOrEqual(points[i - 1]!.seconds);
          expect(points[i]!.total).toBeGreaterThanOrEqual(points[i - 1]!.total);
        }
        const gained = points.reduce((a, p) => a + p.gained, 0);
        expect(gained).toBeCloseTo(points.at(-1)!.total, 6);
        expect(points.at(-1)!.seconds).toBe(
          ((f.replay.finalScoreLoop ?? f.replay.durationLoops) - f.replay.gameStartLoop) / 16,
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

      // heatmap covers every death; talents are tiered in order
      expect(heat!.total).toBe(f.statEvents.filter((s) => s.eventName === 'PlayerDeath').length);
      expect(cells.reduce((a, c) => a + c.count, 0)).toBe(heat!.total);
      expect(heat!.mapWidth).not.toBeNull();
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
