import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NormalizedReplay, ReplayCollectionName } from '../src/model/records.js';
import { REPLAY_COLLECTIONS } from '../src/model/records.js';
import { createMemoryContext } from '../src/analysers/context.js';
import { createRegistry } from '../src/analysers/registry.js';
import type { Analyser } from '../src/analysers/types.js';
import { HeroDb } from '../src/db/HeroDb.js';
import { createDbContext, readRows } from '../src/db/read.js';
import { deleteReplay, writeReplay } from '../src/db/write.js';
import { saveDerived } from '../src/db/derived.js';
import { listReplays, pruneReplays, reanalyse, staleReplays } from '../src/db/maintenance.js';
import { localReplays, normalizeLocal } from './util/node.js';

const replays = localReplays();
let fixtures: NormalizedReplay[] = [];
let db: HeroDb;
let n = 0;

beforeAll(async () => {
  fixtures = await Promise.all(replays.map((f) => normalizeLocal(f)));
});
afterEach(async () => {
  await db?.delete();
});
const fresh = (): HeroDb => (db = new HeroDb(`test-${n++}`));

const sortRows = (rows: readonly unknown[]): unknown[] =>
  [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

describe.skipIf(replays.length === 0)('HeroDb writeReplay', () => {
  it('writes every collection, is idempotent on re-ingest, and measures the write', async () => {
    const db = fresh();
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

    // re-ingesting replaces: same counts, no duplicates
    await writeReplay(db, fixtures[0]!);
    expect(await db.replays.count()).toBe(fixtures.length);
    expect(await db.commands.where('replayId').equals(fixtures[0]!.replay.id).count()).toBe(
      fixtures[0]!.commands.length,
    );
    expect(await db.commands.count()).toBe(fixtures.reduce((a, f) => a + f.commands.length, 0));
  });

  it('keeps the file only when asked and records hasFile', async () => {
    const db = fresh();
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
    // and dropping the file on the next ingest removes it
    await writeReplay(db, f);
    expect(await db.replayFiles.count()).toBe(0);
  });

  it('leaves no rows behind when a write fails part-way', async () => {
    const db = fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f);
    // a duplicate unit primary key makes bulkAdd throw inside the transaction
    const broken: NormalizedReplay = { ...f, units: [...f.units, f.units[0]!], chat: [] };
    await expect(writeReplay(db, broken)).rejects.toThrow();
    // the transaction rolled back: the previous rows are intact, including chat
    expect(await db.chat.where('replayId').equals(f.replay.id).count()).toBe(f.chat.length);
    expect(await db.units.where('replayId').equals(f.replay.id).count()).toBe(f.units.length);
    expect((await db.replays.get(f.replay.id))?.status).toBe(f.replay.status);

    const empty = fresh();
    await expect(writeReplay(empty, broken)).rejects.toThrow();
    expect(await empty.replays.count()).toBe(0);
    for (const name of REPLAY_COLLECTIONS) expect(await empty.table(name).count(), name).toBe(0);
  });

  it('deletes a replay and everything under it', async () => {
    const db = fresh();
    for (const f of fixtures) await writeReplay(db, f);
    await saveDerived(db, {
      replayId: fixtures[0]!.replay.id,
      analyserId: 'a',
      paramsHash: '-',
      analyserVersion: 1,
      result: 1,
      error: null,
      computedAt: 'x',
      ms: 0,
    });
    await deleteReplay(db, fixtures[0]!.replay.id);
    expect(await db.replays.count()).toBe(fixtures.length - 1);
    expect(await db.commands.where('replayId').equals(fixtures[0]!.replay.id).count()).toBe(0);
    expect(await db.derived.count()).toBe(0);
    expect(await db.commands.count()).toBe(
      fixtures.slice(1).reduce((a, f) => a + f.commands.length, 0),
    );
  });
});

describe.skipIf(replays.length === 0)('read parity', () => {
  it('reads the same rows through Dexie as from memory, with and without filters', async () => {
    const db = fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f);
    const mem = createMemoryContext(f);
    const dbCtx = await createDbContext(db, f.replay);
    for (const name of REPLAY_COLLECTIONS as readonly ReplayCollectionName[]) {
      const a = sortRows(await mem.read(name));
      const b = sortRows(await dbCtx.read(name));
      expect(b, name).toEqual(a);
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
});

describe.skipIf(replays.length === 0)('maintenance', () => {
  it('finds stale replays, prunes to the newest N, and lists newest first', async () => {
    const db = fresh();
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

  it('reanalyse recomputes stale and missing rows from the persisted model and drops stale lazy rows', async () => {
    const db = fresh();
    const f = fixtures[0]!;
    await writeReplay(db, f, { status: 'ready' });
    const calls: string[] = [];
    const heroes: Analyser<number> = {
      id: 'heroes',
      version: 2,
      inputs: ['units'],
      mode: 'ready',
      run: async (ctx) => {
        calls.push('heroes');
        return (await ctx.read('units', { unitClass: 'hero' })).length;
      },
    };
    const kills: Analyser<number> = {
      id: 'kills',
      version: 1,
      inputs: ['scoreResults'],
      mode: 'background',
      dependsOn: ['heroes'],
      run: async (ctx) => {
        calls.push('kills');
        return (ctx.results['heroes'] as number) * 10;
      },
    };
    const heat: Analyser<number, { slot: number }> = {
      id: 'heat',
      version: 2,
      inputs: ['units'],
      mode: 'lazy',
      run: () => 0,
    };
    const registry = createRegistry([heroes, kills, heat as never]);
    const row = (analyserId: string, analyserVersion: number, paramsHash = '-') => ({
      replayId: f.replay.id,
      analyserId,
      analyserVersion,
      paramsHash,
      result: 'old',
      error: null,
      computedAt: '2020',
      ms: 0,
    });
    await db.derived.bulkPut([row('heroes', 1), row('heat', 1, 'abc'), row('heat', 2, 'def')]);

    const computed = await reanalyse(db, { registry, replayId: f.replay.id });
    expect(calls).toEqual(['heroes', 'kills']);
    expect(computed.map((r) => [r.analyserId, r.result])).toEqual([
      ['heroes', 10],
      ['kills', 100],
    ]);
    expect((await db.derived.get([f.replay.id, 'heroes', '-']))?.result).toBe(10);
    expect(await db.derived.get([f.replay.id, 'heat', 'abc'])).toBeUndefined(); // stale lazy dropped
    expect((await db.derived.get([f.replay.id, 'heat', 'def']))?.result).toBe('old'); // fresh lazy kept
    expect((await db.replays.get(f.replay.id))?.status).toBe('complete');

    // a second pass finds everything fresh
    calls.length = 0;
    expect(await reanalyse(db, { registry })).toEqual([]);
    expect(calls).toEqual([]);
  });
});
