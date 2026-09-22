import { describe, expect, it } from 'vitest';
import type { NormalizedReplay, ReplayRecord } from '../src/model/records.js';
import { createMemoryContext } from '../src/analysers/context.js';
import { paramsHash, stableStringify, NO_PARAMS } from '../src/analysers/paramsHash.js';
import { AnalyserRegistrationError, createRegistry } from '../src/analysers/registry.js';
import { isFresh, runAnalyser, runAnalysers } from '../src/analysers/runner.js';
import { statSupportFor } from '../src/analysers/statSupport.js';
import type { Analyser, AnalyserStatus, RunClock } from '../src/analysers/types.js';

const replay = { id: 'r1', version: { baseBuild: 85267 } } as unknown as ReplayRecord;
const normalized: NormalizedReplay = {
  replay,
  players: [
    { replayId: 'r1', slot: 0, team: 0, hero: 'Genji' } as never,
    { replayId: 'r1', slot: 5, team: 1, hero: 'Alarak' } as never,
  ],
  scoreResults: [{ replayId: 'r1', slot: 0, team: 0, stats: { Takedowns: 3 } } as never],
  statEvents: [],
  units: [],
  commands: [],
  events: [],
  chat: [],
};

let tick = 0;
const clock: RunClock = { now: () => '2026-01-01T00:00:00.000Z', ms: () => (tick += 10) };

const analyser = <T>(
  id: string,
  run: Analyser<T, void>['run'],
  extra: Partial<Analyser<T, void>> = {},
): Analyser<T, void> => ({
  id,
  version: 1,
  inputs: ['players'],
  mode: 'ready',
  run,
  ...extra,
});

describe('memory context', () => {
  it('reads collections with equality filters and derives stat support', async () => {
    const ctx = createMemoryContext(normalized);
    expect(await ctx.read('players')).toHaveLength(2);
    expect(await ctx.read('players', { team: 1 })).toEqual([normalized.players[1]]);
    expect(await ctx.read('players', { team: 1, slot: 0 })).toEqual([]);
    expect(ctx.statSupport).toEqual({});
    const old = createMemoryContext({
      ...normalized,
      replay: { ...replay, version: { baseBuild: 50000 } } as never,
    });
    expect(old.statSupport['DamageSoaked']?.support).toBe('none');
    expect(old.statSupport['DamageTaken']?.support).toBe('partial');
    expect(old.statSupport['PercentDamageHealed']?.support).toBe('flawed');
    expect(statSupportFor({ baseBuild: 30000, hasScoreResults: true })['*']?.support).toBe('none');
    expect(statSupportFor({ baseBuild: 85267, hasScoreResults: false })['*']?.support).toBe('none');
  });
});

describe('paramsHash', () => {
  it('is stable under key order and undefined fields, and distinguishes values', () => {
    expect(paramsHash(undefined)).toBe(NO_PARAMS);
    expect(paramsHash({ a: 1, b: [1, { c: 2 }] })).toBe(
      paramsHash({ b: [1, { c: 2 }], a: 1, d: undefined }),
    );
    expect(paramsHash({ a: 1 })).not.toBe(paramsHash({ a: 2 }));
    expect(stableStringify({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });
});

describe('registry', () => {
  it('rejects duplicates, missing dependencies, later-mode dependencies and cycles', () => {
    const reg = createRegistry([analyser('a', () => 1)]);
    expect(() => reg.register(analyser('a', () => 1))).toThrow(AnalyserRegistrationError);

    reg.register(analyser('b', () => 1, { dependsOn: ['missing'] }));
    expect(() => reg.validate()).toThrow(/depends on 'missing'/);

    const dir = createRegistry([
      analyser('lazy', () => 1, { mode: 'lazy' }),
      analyser('ready', () => 1, { mode: 'ready', dependsOn: ['lazy'] }),
    ]);
    expect(() => dir.validate()).toThrow(/runs later/);

    // background → ready is fine; the override changes the effective mode
    const ok = createRegistry([analyser('ready', () => 1)]);
    ok.register(analyser('bg', () => 1, { mode: 'background', dependsOn: ['ready'] }));
    expect(() => ok.validate()).not.toThrow();
    ok.register(
      analyser('x', () => 1, { mode: 'lazy' }),
      { mode: 'ready' },
    );
    expect(ok.get('x')?.mode).toBe('ready');
    expect(ok.list('ready').map((r) => r.analyser.id)).toEqual(['ready', 'x']);

    const cyc = createRegistry([
      analyser('p', () => 1, { dependsOn: ['q'] }),
      analyser('q', () => 1, { dependsOn: ['p'] }),
    ]);
    expect(() => cyc.validate()).toThrow(/cycle/);
  });

  it('orders dependencies before dependents', () => {
    const reg = createRegistry([
      analyser('c', () => 1, { dependsOn: ['b'] }),
      analyser('a', () => 1),
      analyser('b', () => 1, { dependsOn: ['a'] }),
    ]);
    expect(reg.order(['c']).map((r) => r.analyser.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('runAnalysers', () => {
  it('runs in dependency order, passes results, isolates failures, and streams status', async () => {
    const calls: string[] = [];
    const statuses: AnalyserStatus[] = [];
    const reg = createRegistry([
      analyser('sum', async (ctx) => {
        calls.push('sum');
        const players = await ctx.read('players');
        ctx.progress(1, 1);
        return players.length;
      }),
      analyser(
        'double',
        (ctx) => {
          calls.push('double');
          return (ctx.results['sum'] as number) * 2;
        },
        { dependsOn: ['sum'], mode: 'background' },
      ),
      analyser(
        'boom',
        () => {
          calls.push('boom');
          throw new Error('kaboom');
        },
        { mode: 'background' },
      ),
      analyser('after-boom', () => 1, { dependsOn: ['boom'], mode: 'background' }),
      analyser(
        'lazy',
        () => {
          calls.push('lazy');
          return 0;
        },
        { mode: 'lazy' },
      ),
    ]);
    const out = await runAnalysers({
      registry: reg,
      ctx: createMemoryContext(normalized),
      modes: ['ready', 'background'],
      clock,
      onStatus: (s) => statuses.push(s),
    });
    expect(calls).toEqual(['sum', 'double', 'boom']); // lazy not run; after-boom skipped
    expect(out.results).toEqual({ sum: 2, double: 4 });
    const byId = Object.fromEntries(out.computed.map((r) => [r.analyserId, r]));
    expect(byId['sum']).toMatchObject({
      replayId: 'r1',
      paramsHash: NO_PARAMS,
      analyserVersion: 1,
      result: 2,
      error: null,
      ms: 10,
    });
    expect(byId['boom']).toMatchObject({ result: null, error: 'kaboom' });
    expect(byId['after-boom']).toMatchObject({ result: null, error: "dependency 'boom' failed" });
    expect(statuses.map((s) => `${s.analyserId}:${s.state}`)).toEqual([
      'sum:queued',
      'sum:running',
      'sum:running',
      'sum:done',
      'double:queued',
      'double:running',
      'double:done',
      'boom:queued',
      'boom:running',
      'boom:failed',
      'after-boom:queued',
      'after-boom:failed',
    ]);
    expect(statuses[2]!.progress).toEqual({ current: 1, total: 1 });
  });

  it('reuses fresh stored results and recomputes stale ones', async () => {
    const calls: string[] = [];
    const reg = createRegistry([
      analyser('fresh', () => {
        calls.push('fresh');
        return 'new';
      }),
      analyser(
        'stale',
        () => {
          calls.push('stale');
          return 'v2';
        },
        { version: 2 },
      ),
      analyser('errored', () => {
        calls.push('errored');
        return 'ok';
      }),
      analyser('dep', (ctx) => `${ctx.results['fresh']}+${ctx.results['stale']}`, {
        dependsOn: ['fresh', 'stale'],
        mode: 'background',
      }),
    ]);
    const row = (
      analyserId: string,
      analyserVersion: number,
      result: unknown,
      error: string | null = null,
    ) => ({
      replayId: 'r1',
      analyserId,
      paramsHash: NO_PARAMS,
      analyserVersion,
      result,
      error,
      computedAt: 'x',
      ms: 0,
    });
    const statuses: AnalyserStatus[] = [];
    const out = await runAnalysers({
      registry: reg,
      ctx: createMemoryContext(normalized),
      modes: ['ready', 'background'],
      clock,
      existing: [
        row('fresh', 1, 'old'),
        row('stale', 1, 'v1'),
        row('errored', 1, null, 'failed before'),
        row('fresh', 1, 'other replay', null) && { ...row('fresh', 1, 'x'), replayId: 'r2' },
      ],
      onStatus: (s) => statuses.push(s),
    });
    expect(calls).toEqual(['stale', 'errored']);
    expect(out.results).toEqual({ fresh: 'old', stale: 'v2', errored: 'ok', dep: 'old+v2' });
    expect(out.computed.map((r) => r.analyserId)).toEqual(['stale', 'errored', 'dep']);
    expect(statuses.find((s) => s.analyserId === 'fresh')?.state).toBe('cached');
    expect(
      isFresh(
        row('a', 1, 1),
        analyser('a', () => 1),
      ),
    ).toBe(true);
    expect(
      isFresh(
        row('a', 1, 1, 'err'),
        analyser('a', () => 1),
      ),
    ).toBe(false);
  });

  it('runs a parameterized analyser lazily under a params-derived key', async () => {
    const heat: Analyser<number, { slot: number }> = {
      id: 'heat',
      version: 3,
      inputs: ['players'],
      mode: 'lazy',
      cache: { maxEntries: 50 },
      run: async (ctx, params) => (await ctx.read('players', { slot: params.slot })).length,
    };
    const ctx = createMemoryContext(normalized);
    const a = await runAnalyser(heat as never, ctx, { slot: 5 }, { clock });
    const b = await runAnalyser(heat as never, ctx, { slot: 7 }, { clock });
    expect(a).toMatchObject({ analyserId: 'heat', analyserVersion: 3, result: 1, error: null });
    expect(b.result).toBe(0);
    expect(a.paramsHash).not.toBe(b.paramsHash);
    expect(a.paramsHash).toBe(paramsHash({ slot: 5 }));
  });
});
