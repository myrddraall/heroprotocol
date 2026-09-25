import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  AnalyserRunRecord,
  NormalizedReplay,
  ReplayCollectionName,
} from '../src/model/records.js';
import { REPLAY_COLLECTIONS } from '../src/model/records.js';
import { createMemoryContext } from '../src/analysers/context.js';
import { createRegistry } from '../src/analysers/registry.js';
import type { Analyser, AnalyserRows } from '../src/analysers/types.js';
import { HeroDb } from '../src/db/HeroDb.js';
import { createDbContext, readRows, readTableRows } from '../src/db/read.js';
import { deleteReplay, writeReplay } from '../src/db/write.js';
import { saveAnalyserOutput } from '../src/db/runs.js';
import { listReplays, pruneReplays, reanalyse, staleReplays } from '../src/db/maintenance.js';
import { localReplays, normalizeLocal } from './util/node.js';

const replays = localReplays();
let fixtures: NormalizedReplay[] = [];
const open: HeroDb[] = [];
let n = 0;

beforeAll(async () => {
  fixtures = await Promise.all(replays.map((f) => normalizeLocal(f)));
});
afterEach(async () => {
  for (const db of open.splice(0)) await db.delete();
});
const fresh = async (tables: Record<string, string> = {}): Promise<HeroDb> => {
  const db = await HeroDb.open(`test-${n++}`, tables);
  open.push(db);
  return db;
};
const sortRows = (rows: readonly unknown[]): unknown[] =>
  [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

describe('HeroDb.open', () => {
  it('adds analyser tables, bumps the version only when the store set changes, and keeps data', async () => {
    const name = `schema-${n++}`;
    const a = await HeroDb.open(name, { t_a: 'replayId, kind, zeta' });
    expect(a.tables.map((t) => t.name)).toContain('t_a');
    expect(a.verno).toBe(1);
    await a.table('t_a').put({ replayId: 'r', kind: 'x' });
    a.close();

    const same = await HeroDb.open(name, { t_a: 'replayId, zeta, kind' }); // same specs, different order
    expect(same.verno).toBe(1);
    expect(await same.table('t_a').count()).toBe(1);
    same.close();

    const more = await HeroDb.open(name, {
      t_a: 'replayId, kind',
      t_b: '[replayId+seq], replayId',
    });
    expect(more.verno).toBe(2);
    expect(more.tables.map((t) => t.name)).toContain('t_b');
    expect(await more.table('t_a').count()).toBe(1); // upgrade kept the rows
    expect(more.analyserTables.map((t) => t.name).sort()).toEqual(['t_a', 't_b']);
    expect(more.replayTables.map((t) => t.name)).not.toContain('ingestJobs');
    more.close();
    await HeroDb.open(name).then(async (core) => {
      expect(core.verno).toBe(3); // fewer stores is also a change
      await core.delete();
    });
  });
});

describe.skipIf(replays.length === 0)('HeroDb writeReplay', () => {
  it('writes every collection, is idempotent on re-ingest, and measures the write', async () => {
    const db = await fresh();
    for (const f of fixtures) {
      const t = performance.now();
      await writeReplay(db, f);
      const ms = performance.now() - t;
      const bytes = JSON.stringify(f).length;
      console.log(
        `write ${f.replay.map} (${f.replay.version.baseBuild}): ${ms.toFixed(0)} ms, ${(bytes / 1024 / 1024).toFixed(1)} MB JSON, ${Object.values(f.replay.rowCounts).reduce((a, b) => a + b, 0)} rows`,
      );
      for (const name of REPLAY_COLLECTIONS as readonly ReplayCollectionName[]) {
        expect(await db.table(name).where('replayId').equals(f.replay.id).count(), name).toBe(
          f[name].length,
        );
      }
    }
    expect(await db.replays.count()).toBe(fixtures.length);
    await writeReplay(db, fixtures[0]!);
    expect(await db.replays.count()).toBe(fixtures.length);
    expect(await db.commands.where('replayId').equals(fixtures[0]!.replay.id).count()).toBe(
      fixtures[0]!.commands.length,
    );
    expect(await db.commands.count()).toBe(fixtures.reduce((a, f) => a + f.commands.length, 0));
  });

  it('keeps the file only when asked and records hasFile', async () => {
    const db = await fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f);
    expect((await db.replays.get(f.replay.id))?.hasFile).toBe(false);
    expect(await db.replayFiles.count()).toBe(0);
    await writeReplay(db, f, {
      file: { name: 'x.StormReplay', bytes: new Uint8Array([1, 2, 3]) },
      status: 'analysing',
    });
    const r = await db.replays.get(f.replay.id);
    expect(r?.hasFile).toBe(true);
    expect(r?.status).toBe('analysing');
    expect((await db.replayFiles.get(f.replay.id))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    await writeReplay(db, f);
    expect(await db.replayFiles.count()).toBe(0);
  });

  it('leaves no rows behind when a write fails part-way', async () => {
    const db = await fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f);
    const broken: NormalizedReplay = { ...f, units: [...f.units, f.units[0]!], chat: [] };
    await expect(writeReplay(db, broken)).rejects.toThrow();
    expect(await db.chat.where('replayId').equals(f.replay.id).count()).toBe(f.chat.length);
    expect(await db.units.where('replayId').equals(f.replay.id).count()).toBe(f.units.length);
    expect((await db.replays.get(f.replay.id))?.status).toBe(f.replay.status);

    const empty = await fresh();
    await expect(writeReplay(empty, broken)).rejects.toThrow();
    expect(await empty.replays.count()).toBe(0);
    for (const name of REPLAY_COLLECTIONS) expect(await empty.table(name).count(), name).toBe(0);
  });

  it('deletes a replay and everything under it, analyser tables included', async () => {
    const db = await fresh({ t_x: '[replayId+seq], replayId' });
    for (const f of fixtures) await writeReplay(db, f);
    const id = fixtures[0]!.replay.id;
    await db.table('t_x').bulkAdd([
      { replayId: id, seq: 0 },
      { replayId: id, seq: 1 },
      { replayId: fixtures[1]!.replay.id, seq: 0 },
    ]);
    const run: AnalyserRunRecord = {
      replayId: id,
      analyserId: 'a',
      paramsHash: '-',
      analyserVersion: 1,
      error: null,
      computedAt: 'x',
      ms: 0,
    };
    await db.analyserRuns.put(run);
    await deleteReplay(db, id);
    expect(await db.replays.count()).toBe(fixtures.length - 1);
    expect(await db.commands.where('replayId').equals(id).count()).toBe(0);
    expect(await db.analyserRuns.count()).toBe(0);
    expect(await db.table('t_x').count()).toBe(1);
    expect(await db.commands.count()).toBe(
      fixtures.slice(1).reduce((a, f) => a + f.commands.length, 0),
    );
  });
});

describe.skipIf(replays.length === 0)('read parity', () => {
  it('reads the same rows through Dexie as from memory, with and without filters', async () => {
    const db = await fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f);
    const mem = createMemoryContext(f);
    const dbCtx = await createDbContext(db, f.replay);
    for (const name of REPLAY_COLLECTIONS as readonly ReplayCollectionName[]) {
      expect(sortRows(await dbCtx.read(name)), name).toEqual(sortRows(await mem.read(name)));
    }
    const filters: [ReplayCollectionName, Record<string, unknown>][] = [
      ['players', { team: 1 }],
      ['statEvents', { eventName: 'PlayerDeath' }],
      ['statEvents', { eventName: 'LevelUp', playerSlot: 3 }],
      ['units', { unitClass: 'hero' }],
      ['units', { killerSlot: 0, unitClass: 'minion' }],
      ['commands', { playerSlot: 7 }],
      ['events', { kind: 'Ping' }],
      ['events', { playerSlot: 2, kind: 'UnitClick' }],
      ['chat', { kind: 'ping' }],
    ];
    for (const [name, where] of filters) {
      const a = sortRows(await mem.read(name, where as never));
      const b = sortRows(await readRows(db, name, f.replay.id, where as never));
      expect(a.length, JSON.stringify(where)).toBeGreaterThan(0);
      expect(b, JSON.stringify(where)).toEqual(a);
    }
    expect(dbCtx.statSupport).toEqual(mem.statSupport);
  });

  it('reads analyser tables by replay range, one-row tables included', async () => {
    const db = await fresh({ t_rows: '[replayId+seq], replayId, kind', t_one: 'replayId' });
    await db.table('t_rows').bulkAdd([
      { replayId: 'r1', seq: 0, kind: 'a' },
      { replayId: 'r1', seq: 1, kind: 'b' },
      { replayId: 'r2', seq: 0, kind: 'a' },
    ]);
    await db.table('t_one').bulkAdd([
      { replayId: 'r1', total: 3 },
      { replayId: 'r2', total: 4 },
    ]);
    expect(await readTableRows(db, 't_rows', 'r1')).toHaveLength(2);
    expect(await readTableRows(db, 't_rows', 'r1', { kind: 'b' })).toEqual([
      { replayId: 'r1', seq: 1, kind: 'b' },
    ]);
    expect(await readTableRows(db, 't_one', 'r2')).toEqual([{ replayId: 'r2', total: 4 }]);
    await expect(readTableRows(db, 't_nope', 'r1')).rejects.toThrow(/not in the database/);
  });
});

describe.skipIf(replays.length === 0)('maintenance', () => {
  it('finds stale replays, prunes to the newest N, and lists newest first', async () => {
    const db = await fresh();
    for (const [i, f] of fixtures.entries()) {
      await writeReplay(db, {
        ...f,
        replay: {
          ...f.replay,
          ingestedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
          normalizeVersion: i === 0 ? 0 : f.replay.normalizeVersion,
        },
      });
    }
    expect((await staleReplays(db)).map((r) => r.id)).toEqual([fixtures[0]!.replay.id]);
    expect((await listReplays(db)).map((r) => r.ingestedAt)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    const removed = await pruneReplays(db, { keep: 1 });
    expect(removed).toEqual([fixtures[1]!.replay.id, fixtures[0]!.replay.id]);
    expect(await db.replays.count()).toBe(1);
    expect(await db.units.count()).toBe(fixtures[2]!.units.length);
  });

  it('reanalyse recomputes stale and missing runs into their tables and drops stale lazy runs with their rows', async () => {
    const calls: string[] = [];
    const heroes: Analyser<AnalyserRows, void> = {
      id: 'heroes',
      version: 2,
      tables: { heroesCount: 'replayId' },
      inputs: ['units'],
      mode: 'ready',
      run: async (ctx) => {
        calls.push('heroes');
        return { heroesCount: [{ n: (await ctx.read('units', { unitClass: 'hero' })).length }] };
      },
    };
    const kills: Analyser<AnalyserRows, void> = {
      id: 'kills',
      version: 1,
      tables: { killsCount: 'replayId' },
      inputs: ['scoreResults'],
      mode: 'background',
      dependsOn: ['heroes'],
      run: async (ctx) => {
        calls.push('kills');
        const [h] = await ctx.readTable<{ n: number }>('heroesCount');
        return { killsCount: [{ n: h!.n * 10 }] };
      },
    };
    const heat: Analyser<AnalyserRows, { slot: number }> = {
      id: 'heat',
      version: 2,
      tables: { heatCells: '[replayId+paramsHash+seq], replayId' },
      inputs: ['units'],
      mode: 'lazy',
      run: () => ({ heatCells: [] }),
    };
    const registry = createRegistry([heroes, kills, heat as never]);
    const db = await fresh(registry.tables());
    const f = fixtures[0]!;
    await writeReplay(db, f, { status: 'ready' });
    const run = (
      analyserId: string,
      analyserVersion: number,
      paramsHash = '-',
    ): AnalyserRunRecord => ({
      replayId: f.replay.id,
      analyserId,
      analyserVersion,
      paramsHash,
      error: null,
      computedAt: '2020',
      ms: 0,
    });
    await db.analyserRuns.bulkPut([run('heroes', 1), run('heat', 1, 'abc'), run('heat', 2, 'def')]);
    await db.table('heroesCount').put({ replayId: f.replay.id, n: -1 });
    await db.table('heatCells').bulkAdd([
      { replayId: f.replay.id, paramsHash: 'abc', seq: 0 },
      { replayId: f.replay.id, paramsHash: 'def', seq: 0 },
    ]);

    const computed = await reanalyse(db, { registry, replayId: f.replay.id });
    expect(calls).toEqual(['heroes', 'kills']);
    expect(computed.map((o) => [o.run.analyserId, o.rows])).toEqual([
      ['heroes', { heroesCount: [{ n: 10, replayId: f.replay.id }] }],
      ['kills', { killsCount: [{ n: 100, replayId: f.replay.id }] }],
    ]);
    expect(await db.table('heroesCount').toArray()).toEqual([{ replayId: f.replay.id, n: 10 }]); // stale row replaced
    expect((await db.analyserRuns.get([f.replay.id, 'heroes', '-']))?.analyserVersion).toBe(2);
    expect(await db.analyserRuns.get([f.replay.id, 'heat', 'abc'])).toBeUndefined(); // stale lazy dropped …
    expect(await db.table('heatCells').where('replayId').equals(f.replay.id).toArray()).toEqual([
      { replayId: f.replay.id, paramsHash: 'def', seq: 0 }, // … with its rows; the fresh one kept
    ]);
    expect((await db.replays.get(f.replay.id))?.status).toBe('complete');

    calls.length = 0;
    expect(await reanalyse(db, { registry })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('saveAnalyserOutput replaces a run and bounds parameterized caches', async () => {
    const heat: Analyser<AnalyserRows, { slot: number }> = {
      id: 'heat',
      version: 1,
      tables: { heatCells: '[replayId+paramsHash+seq], replayId' },
      inputs: [],
      mode: 'lazy',
      cache: { maxEntries: 2 },
      run: () => ({}),
    };
    const db = await fresh({ heatCells: '[replayId+paramsHash+seq], replayId' });
    const output = (hash: string, at: string, seqs: number[]) => ({
      run: {
        replayId: 'r',
        analyserId: 'heat',
        paramsHash: hash,
        analyserVersion: 1,
        error: null,
        computedAt: at,
        ms: 0,
      },
      rows: { heatCells: seqs.map((seq) => ({ replayId: 'r', paramsHash: hash, seq })) },
    });
    await saveAnalyserOutput(db, heat as never, output('a', '1', [0, 1]));
    await saveAnalyserOutput(db, heat as never, output('a', '2', [0])); // same params: replaced, not appended
    expect(await db.table('heatCells').count()).toBe(1);
    await saveAnalyserOutput(db, heat as never, output('b', '3', [0]));
    await saveAnalyserOutput(db, heat as never, output('c', '4', [0, 1, 2]));
    expect((await db.analyserRuns.toArray()).map((r) => r.paramsHash).sort()).toEqual(['b', 'c']); // 'a' evicted
    expect(
      (await db.table('heatCells').toArray())
        .map((r) => (r as { paramsHash: string }).paramsHash)
        .sort(),
    ).toEqual(['b', 'c', 'c', 'c']);
  });
});
