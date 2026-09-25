import { describe, expect, it } from 'vitest';
import type { AnalyserRunRecord, NormalizedReplay, ReplayRecord } from '../src/model/records.js';
import { createMemoryContext, TableSink } from '../src/analysers/context.js';
import { paramsHash, stableStringify, NO_PARAMS } from '../src/analysers/paramsHash.js';
import {
  AnalyserRegistrationError,
  createRegistry,
  keyStartsWithReplayId,
  primaryKeyOf,
} from '../src/analysers/registry.js';
import { isFresh, runAnalyser, runAnalysers, stampRows } from '../src/analysers/runner.js';
import { statSupportFor } from '../src/analysers/statSupport.js';
import type { Analyser, AnalyserRows, AnalyserStatus, RunClock } from '../src/analysers/types.js';

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

type Rows = AnalyserRows;
/** A test analyser with one single-row table named after it, unless `tables` is given. */
const analyser = (
  id: string,
  run: Analyser<Rows, void>['run'],
  extra: Partial<Analyser<Rows, void>> = {},
): Analyser<Rows, void> => ({
  id,
  version: 1,
  tables: { [`t_${id}`]: 'replayId' },
  inputs: ['players'],
  mode: 'ready',
  run,
  ...extra,
});
const one = (value: unknown) => ({ value });

describe('memory context', () => {
  it('reads core collections with equality filters, analyser tables from the sink, and derives stat support', async () => {
    const sink = new TableSink();
    sink.add('t_dep', [
      { replayId: 'r1', value: 1 },
      { replayId: 'r1', value: 2 },
    ]);
    const ctx = createMemoryContext(normalized, { tables: sink });
    expect(await ctx.read('players')).toHaveLength(2);
    expect(await ctx.read('players', { team: 1 })).toEqual([normalized.players[1]]);
    expect(await ctx.read('players', { team: 1, slot: 0 })).toEqual([]);
    expect(await ctx.readTable('t_dep')).toHaveLength(2);
    expect(await ctx.readTable('t_dep', { value: 2 })).toEqual([{ replayId: 'r1', value: 2 }]);
    expect(await ctx.readTable('t_missing')).toEqual([]);
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
  it('validates table declarations: unique names, no core names, replayId-first keys', () => {
    expect(primaryKeyOf('[replayId+slot], replayId, slot')).toBe('[replayId+slot]');
    expect(keyStartsWithReplayId('replayId')).toBe(true);
    expect(keyStartsWithReplayId('[replayId+seq]')).toBe(true);
    expect(keyStartsWithReplayId('++id')).toBe(false);
    expect(keyStartsWithReplayId('[slot+replayId]')).toBe(false);

    const reg = createRegistry([analyser('a', () => ({}))]);
    expect(() => reg.register(analyser('b', () => ({}), { tables: { t_a: 'replayId' } }))).toThrow(
      /already declared by 'a'/,
    );
    expect(() =>
      reg.register(analyser('c', () => ({}), { tables: { players: 'replayId' } })),
    ).toThrow(/core table/);
    expect(() =>
      reg.register(analyser('d', () => ({}), { tables: { t_d: '++id, replayId' } })),
    ).toThrow(/must start with replayId/);
    reg.register(
      analyser('e', () => ({}), {
        tables: { e_rows: '[replayId+seq], replayId, kind', e_summary: 'replayId' },
      }),
    );
    expect(reg.tables()).toEqual({
      t_a: 'replayId',
      e_rows: '[replayId+seq], replayId, kind',
      e_summary: 'replayId',
    });
    expect(reg.ownerOf('e_rows')).toBe('e');
  });

  it('rejects duplicates, missing dependencies, later-mode dependencies and cycles', () => {
    const reg = createRegistry([analyser('a', () => ({}))]);
    expect(() => reg.register(analyser('a', () => ({})))).toThrow(AnalyserRegistrationError);

    reg.register(analyser('b', () => ({}), { dependsOn: ['missing'] }));
    expect(() => reg.validate()).toThrow(/depends on 'missing'/);

    const dir = createRegistry([
      analyser('lazy', () => ({}), { mode: 'lazy' }),
      analyser('ready', () => ({}), { mode: 'ready', dependsOn: ['lazy'] }),
    ]);
    expect(() => dir.validate()).toThrow(/runs later/);

    const ok = createRegistry([analyser('ready', () => ({}))]);
    ok.register(analyser('bg', () => ({}), { mode: 'background', dependsOn: ['ready'] }));
    expect(() => ok.validate()).not.toThrow();
    ok.register(
      analyser('x', () => ({}), { mode: 'lazy' }),
      { mode: 'ready' },
    );
    expect(ok.get('x')?.mode).toBe('ready');
    expect(ok.list('ready').map((r) => r.analyser.id)).toEqual(['ready', 'x']);

    const cyc = createRegistry([
      analyser('p', () => ({}), { dependsOn: ['q'] }),
      analyser('q', () => ({}), { dependsOn: ['p'] }),
    ]);
    expect(() => cyc.validate()).toThrow(/cycle/);
  });

  it('orders dependencies before dependents', () => {
    const reg = createRegistry([
      analyser('c', () => ({}), { dependsOn: ['b'] }),
      analyser('a', () => ({})),
      analyser('b', () => ({}), { dependsOn: ['a'] }),
    ]);
    expect(reg.order(['c']).map((r) => r.analyser.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stampRows', () => {
  it('stamps replayId (and paramsHash) and drops undeclared tables', () => {
    const a = analyser('s', () => ({}), { tables: { s_rows: '[replayId+seq]' } });
    expect(stampRows(a, 'r1', NO_PARAMS, { s_rows: [{ seq: 0 }], stray: [{ x: 1 }] })).toEqual({
      s_rows: [{ seq: 0, replayId: 'r1' }],
    });
    expect(stampRows(a, 'r1', 'abc', { s_rows: [{ seq: 0 }] })).toEqual({
      s_rows: [{ seq: 0, replayId: 'r1', paramsHash: 'abc' }],
    });
  });
});

describe('runAnalysers', () => {
  it('runs in dependency order, lets dependents read produced rows, isolates failures, and streams status', async () => {
    const calls: string[] = [];
    const statuses: AnalyserStatus[] = [];
    const reg = createRegistry([
      analyser('sum', async (ctx) => {
        calls.push('sum');
        const players = await ctx.read('players');
        ctx.progress(1, 1);
        return { t_sum: [one(players.length)] };
      }),
      analyser(
        'double',
        async (ctx) => {
          calls.push('double');
          const [row] = await ctx.readTable<{ value: number }>('t_sum');
          return { t_double: [one(row!.value * 2)] };
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
      analyser('after-boom', () => ({}), { dependsOn: ['boom'], mode: 'background' }),
      analyser(
        'lazy',
        () => {
          calls.push('lazy');
          return {};
        },
        { mode: 'lazy' },
      ),
    ]);
    const sink = new TableSink();
    const committed: string[] = [];
    const out = await runAnalysers({
      registry: reg,
      ctx: createMemoryContext(normalized, { tables: sink }),
      modes: ['ready', 'background'],
      sink,
      clock,
      onStatus: (s) => statuses.push(s),
      onComputed: (o) => {
        committed.push(o.run.analyserId);
      },
    });
    expect(calls).toEqual(['sum', 'double', 'boom']); // lazy not run; after-boom skipped
    const byId = Object.fromEntries(out.computed.map((o) => [o.run.analyserId, o]));
    expect(byId['sum']!.run).toMatchObject({
      replayId: 'r1',
      paramsHash: NO_PARAMS,
      analyserVersion: 1,
      error: null,
      ms: 10,
    });
    expect(byId['sum']!.rows).toEqual({ t_sum: [{ value: 2, replayId: 'r1' }] });
    expect(byId['double']!.rows).toEqual({ t_double: [{ value: 4, replayId: 'r1' }] });
    expect(byId['boom']!.run.error).toBe('kaboom');
    expect(byId['boom']!.rows).toEqual({});
    expect(byId['after-boom']!.run.error).toBe("dependency 'boom' failed");
    expect(sink.get('t_double')).toEqual([{ value: 4, replayId: 'r1' }]);
    expect(committed).toEqual(['sum', 'double', 'boom', 'after-boom']);
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

  it('reuses fresh recorded runs and recomputes stale or errored ones', async () => {
    const calls: string[] = [];
    const reg = createRegistry([
      analyser('fresh', () => {
        calls.push('fresh');
        return { t_fresh: [one('new')] };
      }),
      analyser(
        'stale',
        () => {
          calls.push('stale');
          return { t_stale: [one('v2')] };
        },
        { version: 2 },
      ),
      analyser('errored', () => {
        calls.push('errored');
        return {};
      }),
    ]);
    const run = (
      analyserId: string,
      analyserVersion: number,
      error: string | null = null,
    ): AnalyserRunRecord => ({
      replayId: 'r1',
      analyserId,
      paramsHash: NO_PARAMS,
      analyserVersion,
      error,
      computedAt: 'x',
      ms: 0,
    });
    const statuses: AnalyserStatus[] = [];
    const out = await runAnalysers({
      registry: reg,
      ctx: createMemoryContext(normalized),
      modes: ['ready'],
      clock,
      existing: [
        run('fresh', 1),
        run('stale', 1),
        run('errored', 1, 'failed before'),
        { ...run('fresh', 1), replayId: 'r2' },
      ],
      onStatus: (s) => statuses.push(s),
    });
    expect(calls).toEqual(['stale', 'errored']);
    expect(out.reused).toEqual(['fresh']);
    expect(out.computed.map((o) => o.run.analyserId)).toEqual(['stale', 'errored']);
    expect(statuses.find((s) => s.analyserId === 'fresh')?.state).toBe('cached');
    expect(
      isFresh(
        run('a', 1),
        analyser('a', () => ({})),
      ),
    ).toBe(true);
    expect(
      isFresh(
        run('a', 1, 'err'),
        analyser('a', () => ({})),
      ),
    ).toBe(false);
  });

  it('runs a parameterized analyser under a params-derived key with paramsHash on its rows', async () => {
    const heat: Analyser<{ heat: { slot: number; n: number }[] }, { slot: number }> = {
      id: 'heat',
      version: 3,
      tables: { heat: '[replayId+paramsHash+slot], replayId' },
      inputs: ['players'],
      mode: 'lazy',
      cache: { maxEntries: 50 },
      run: async (ctx, params) => ({
        heat: [{ slot: params.slot, n: (await ctx.read('players', { slot: params.slot })).length }],
      }),
    };
    const ctx = createMemoryContext(normalized);
    const a = await runAnalyser(heat as never, ctx, { slot: 5 }, { clock });
    const b = await runAnalyser(heat as never, ctx, { slot: 7 }, { clock });
    expect(a.run).toMatchObject({ analyserId: 'heat', analyserVersion: 3, error: null });
    expect(a.rows).toEqual({
      heat: [{ slot: 5, n: 1, replayId: 'r1', paramsHash: a.run.paramsHash }],
    });
    expect((b.rows['heat']![0] as { n: number }).n).toBe(0);
    expect(a.run.paramsHash).not.toBe(b.run.paramsHash);
    expect(a.run.paramsHash).toBe(paramsHash({ slot: 5 }));
  });
});
