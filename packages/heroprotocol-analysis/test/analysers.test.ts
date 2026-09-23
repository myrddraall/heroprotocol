import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import {
  createReplayDb,
  createRegistry,
  createWorker,
  HeroDb,
  type DerivedRecord,
  type NormalizedReplay,
  type WorkerLike,
  type WorkerScope,
} from '@myrddraall/heroprotocol-db';
import { builtins } from '../src/builtins.js';
import { createBuiltinRegistry } from '../src/index.js';
import type { Description } from '../src/analysers/description.js';
import type { ScoreScreen } from '../src/analysers/scoreScreen.js';
import type { PlayerStats } from '../src/analysers/playerStats.js';
import type { Draft } from '../src/analysers/draft.js';
import type { Timeline } from '../src/analysers/timeline.js';
import type { XpCurve } from '../src/analysers/xpCurve.js';
import type { UnitKills } from '../src/analysers/unitKills.js';
import type { ChatLine } from '../src/analysers/chat.js';
import type { PlayerCommands } from '../src/analysers/commands.js';
import type { DeathHeatmap } from '../src/analysers/deathHeatmap.js';
import type { PointsOfInterest } from '../src/analysers/pointsOfInterest.js';
import type { PlayerTalents } from '../src/analysers/talents.js';
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
  it('registers every built-in with a valid dependency graph, in viewer order', () => {
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
    expect(builtins.every((a) => a.id.startsWith('@myrddraall/') && a.version >= 1)).toBe(true);
  });
});

describe.skipIf(replays.length === 0)('built-in analysers on real replays', () => {
  describe.each(replays)('%s', (file) => {
    it('produce identical results at ingest (memory) and lazily (store)', async () => {
      const f = fixtures.get(file)!;
      const mem = await runInMemory(f);
      const { results, db } = await runFromStore(f, `analysis-${n++}`);
      dbs.push(db);
      expect(Object.keys(results).sort()).toEqual(Object.keys(mem).sort());
      for (const id of Object.keys(mem)) expect(stable(results[id]), id).toEqual(stable(mem[id]));
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
      const description = r['@myrddraall/description'] as Description;
      const score = r['@myrddraall/score-screen'] as ScoreScreen;
      const stats = r['@myrddraall/player-stats'] as PlayerStats;
      const draft = r['@myrddraall/draft'] as Draft;
      const tl = r['@myrddraall/timeline'] as Timeline;
      const xp = r['@myrddraall/xp-curve'] as XpCurve;
      const kills = r['@myrddraall/unit-kills'] as UnitKills;
      const chat = r['@myrddraall/chat'] as ChatLine[];
      const cmds = r['@myrddraall/commands'] as PlayerCommands[];
      const heat = r['@myrddraall/death-heatmap#-'] as DeathHeatmap;
      const poi = r['@myrddraall/points-of-interest'] as PointsOfInterest;
      const talents = r['@myrddraall/talents'] as PlayerTalents[];

      // description: ten participants, the winner is consistent
      expect(description.players).toHaveLength(10);
      expect(
        description.players.filter((p) => p.won).every((p) => p.team === description.winningTeam),
      ).toBe(true);
      expect(description.durationSeconds).toBe(f.replay.durationSeconds);

      // score screen: each team's kills are the other team's deaths, winner flagged
      const deaths = (team: 0 | 1) =>
        score.players.filter((p) => p.team === team).reduce((a, p) => a + (p.stats.Deaths ?? 0), 0);
      expect(score.teams[0]!.kills).toBe(deaths(1));
      expect(score.teams[1]!.kills).toBe(deaths(0));
      expect(score.teams.filter((t) => t.won)).toHaveLength(1);
      expect(score.players.every((p) => p.stats.Takedowns !== null)).toBe(true);

      // player stats: derived fields present, no award booleans, recomputed solo kills ≤ takedowns
      for (const p of stats.players) {
        expect(Object.keys(p.stats).some((k) => k.endsWith('Boolean'))).toBe(false);
        expect(p.stats['KillParticipation']).toBeGreaterThanOrEqual(0);
        expect(p.stats['KillParticipation']).toBeLessThanOrEqual(1);
        expect(p.stats['SoloKill']!).toBeLessThanOrEqual(p.stats['Takedowns']!);
        expect(p.stats['MinionsKilled']).toBe(
          kills.players.find((k) => k.slot === p.slot)!.kills.minions,
        );
        expect(p.stats['RegenGlobesCollected']).toBeGreaterThanOrEqual(0);
        expect(p.stats['TimeDisconnected']).toBeGreaterThanOrEqual(0);
        expect(p.stats['Reconnects']).toBeGreaterThanOrEqual(0); // not inflated by the initial join
      }
      expect(stats.statSupport).toEqual({}); // all three fixtures are ≥ 63507
      const leaver = description.players.find((p) => p.leftAtSeconds !== null);
      if (leaver)
        expect(
          stats.players.find((p) => p.slot === leaver.slot)!.stats['TimeDisconnected'],
        ).toBeGreaterThan(0);

      // draft: steps are in real order and picks name real players
      expect(draft.steps.map((s) => s.order)).toEqual(draft.steps.map((_, i) => i + 1));
      for (let i = 1; i < draft.steps.length; i++)
        expect(draft.steps[i]!.gameloop).toBeGreaterThanOrEqual(draft.steps[i - 1]!.gameloop);
      expect(draft.picks.every((p) => p.slot !== null && p.name !== null)).toBe(true);
      if (draft.picking === 'draft') expect(draft.bans.length).toBeGreaterThan(0);

      // timeline: level events carry numeric levels once each, talents appear with names, spans tile the game
      const levels = tl.events.filter((e) => e.kind === 'level');
      const levelUps = f.statEvents.filter((s) => s.eventName === 'LevelUp').length;
      expect(levels).toHaveLength(levelUps); // the 2018 version emitted these twice
      expect(levels.every((e) => e.level > 0)).toBe(true);
      const talentEvents = tl.events.filter((e) => e.kind === 'talent');
      expect(talentEvents.length).toBe(f.players.reduce((a, p) => a + p.talents.length, 0)); // and never emitted these
      expect(talentEvents.every((e) => e.talent.length > 0 && e.level > 0)).toBe(true);
      for (const p of description.players) {
        const spans = tl.events.filter(
          (e) => (e.kind === 'alive' || e.kind === 'dead') && e.slot === p.slot,
        );
        expect(spans[0]!.start).toBe(0);
        expect((spans.at(-1) as { end: number }).end).toBe(f.replay.durationLoops);
        for (let i = 1; i < spans.length; i++)
          expect(spans[i]!.start).toBe((spans[i - 1] as { end: number }).end);
      }
      expect(tl.events.filter((e) => e.kind === 'core-death')).toHaveLength(1);
      for (let i = 1; i < tl.events.length; i++)
        expect(tl.events[i]!.start).toBeGreaterThanOrEqual(tl.events[i - 1]!.start);

      // xp curve: monotonic time per team, cumulative non-decreasing, ends at the final score
      for (const team of xp) {
        expect(team.points.length).toBeGreaterThan(2);
        for (let i = 1; i < team.points.length; i++) {
          expect(team.points[i]!.seconds).toBeGreaterThanOrEqual(team.points[i - 1]!.seconds);
          expect(team.points[i]!.cumulative).toBeGreaterThanOrEqual(team.points[i - 1]!.cumulative);
        }
        expect(team.points.at(-1)!.seconds).toBe(
          (f.replay.finalScoreLoop ?? f.replay.durationLoops) / 16,
        );
      }

      // unit kills: totals add up; hero kills are takedowns credited to the last hitter
      for (const p of kills.players) {
        const k = p.kills;
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
      expect(kills.teams[0]!.kills.total + kills.teams[1]!.kills.total).toBe(
        kills.players.reduce((a, p) => a + p.kills.total, 0),
      );

      // chat is joined with players (the 2018 version awaited nothing and returned no names)
      expect(chat.length).toBe(f.chat.length);
      expect(
        chat.filter((c) => c.kind === 'chat').every((c) => c.name !== null && c.name.length > 0),
      ).toBe(true);

      // commands: per-minute buckets sum to the total, APM is positive
      for (const p of cmds) {
        expect(p.perMinute.reduce((a, b) => a + b, 0)).toBe(p.commands);
        expect(p.casts + p.moves).toBe(p.commands);
        expect(p.apm).toBeGreaterThan(0);
      }
      expect(cmds.reduce((a, p) => a + p.commands, 0)).toBe(f.commands.length);

      // heatmap covers every death; POIs include the two cores
      expect(heat.total).toBe(f.statEvents.filter((s) => s.eventName === 'PlayerDeath').length);
      expect(heat.cells.reduce((a, c) => a + c.count, 0)).toBe(heat.total);
      expect(heat.mapSize).not.toBeNull();
      expect(poi.points.filter((p) => p.type === 'core')).toHaveLength(2);
      expect(talents.every((t) => t.talents.every((x, i) => x.tier === i + 1))).toBe(true);
    });
  });

  it('lazy flow end to end: absent → analyse() streams status → liveQuery fires → second call is cached; version bump recomputes; mode override at registration', async () => {
    const file = replays[0]!;
    const { scope, worker } = (() => {
      const ch = new MessageChannel();
      return {
        scope: ch.port1 as unknown as WorkerScope,
        worker: ch.port2 as unknown as WorkerLike,
      };
    })();
    // the host overrides one mode at registration: commands becomes a background analyser
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
    dbs.push(client.db);
    const analysers = await client.ready;
    expect(analysers.find((a) => a.id === '@myrddraall/commands')?.mode).toBe('background');
    expect(analysers.find((a) => a.id === '@myrddraall/death-heatmap')?.mode).toBe('lazy');

    const { replayId } = await client.ingest(readLocal(file), { fileName: file }).complete;
    expect(await client.db.derived.get([replayId, '@myrddraall/commands', '-'])).toBeDefined(); // ran in the background now
    expect(
      await client.db.derived
        .where('[replayId+analyserId]')
        .equals([replayId, '@myrddraall/death-heatmap'])
        .count(),
    ).toBe(0);

    // liveQuery on the derived rows fires when the lazy result lands
    const seen: DerivedRecord[][] = [];
    const sub = liveQuery(() =>
      client.db.derived
        .where('[replayId+analyserId]')
        .equals([replayId, '@myrddraall/death-heatmap'])
        .toArray(),
    ).subscribe((rows) => seen.push(rows));
    await new Promise((r) => setTimeout(r, 20));
    const states: string[] = [];
    const first = await client.analyse(replayId, '@myrddraall/death-heatmap', {
      params: { team: 1 },
      onStatus: (s) => states.push(s.state),
    });
    expect(states).toEqual(['running', 'done']);
    expect((first.result as DeathHeatmap).total).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toHaveLength(1);
    sub.unsubscribe();

    const second = await client.analyse(replayId, '@myrddraall/death-heatmap', {
      params: { team: 1 },
      onStatus: (s) => states.push(s.state),
    });
    expect(states.at(-1)).toBe('cached');
    expect(second).toEqual(first);

    // a version bump on the analyser makes the stored row stale
    const bumped = createRegistry(
      builtins.map((a) =>
        a.id === '@myrddraall/death-heatmap' ? { ...a, version: a.version + 1 } : a,
      ),
    );
    const { analyse } = await import('@myrddraall/heroprotocol-db');
    const recomputed = await analyse(client.db, replayId, '@myrddraall/death-heatmap', {
      registry: bumped,
      params: { team: 1 },
    });
    expect(recomputed.analyserVersion).toBe(first.analyserVersion + 1);
    expect(recomputed.computedAt >= first.computedAt).toBe(true);

    await client.close();
    await handle.dispose();
  });
});
