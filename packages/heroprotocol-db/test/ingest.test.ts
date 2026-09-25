import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../src/analysers/registry.js';
import type { Analyser, AnalyserRows, RunClock } from '../src/analysers/types.js';
import { HeroDb } from '../src/db/HeroDb.js';
import { saveAnalyserOutput } from '../src/db/runs.js';
import { analyse } from '../src/ingest/lazy.js';
import { ingestInline } from '../src/ingest/pipeline.js';
import type { IngestStatus } from '../src/ingest/status.js';
import { LOCAL, localReplays } from './util/node.js';

const replays = localReplays();
const open: HeroDb[] = [];
let n = 0;
afterEach(async () => {
  for (const db of open.splice(0)) await db.delete();
});
const fresh = async (tables: Record<string, string> = {}): Promise<HeroDb> => {
  const db = await HeroDb.open(`ingest-${n++}`, tables);
  open.push(db);
  return db;
};

let tick = 0;
// monotonic: each ms() call advances 100 ms, and now() reflects it, so computedAt orders like real time
const clock: RunClock = {
  now: () => new Date(1_700_000_000_000 + tick).toISOString(),
  ms: () => (tick += 100),
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe.skipIf(replays.length === 0)('ingestInline', () => {
  const file = replays[0]!;
  const bytes = () => new Uint8Array(readFileSync(join(LOCAL, file)));

  it('walks ingesting → analysing → ready → complete, writing analyser tables, resolving ready before background work', async () => {
    const gate = deferred<void>();
    const seen: string[] = [];
    const readyA: Analyser<AnalyserRows, void> = {
      id: 'ready-a',
      version: 1,
      tables: { playerCount: 'replayId' },
      inputs: ['players'],
      mode: 'ready',
      run: async (ctx) => ({ playerCount: [{ n: (await ctx.read('players')).length }] }),
    };
    const readyB: Analyser<AnalyserRows, void> = {
      id: 'ready-b',
      version: 1,
      tables: { playerLabel: 'replayId' },
      inputs: [],
      mode: 'ready',
      dependsOn: ['ready-a'],
      run: async (ctx) => ({
        playerLabel: [
          { label: `players=${(await ctx.readTable<{ n: number }>('playerCount'))[0]!.n}` },
        ],
      }),
    };
    const bg: Analyser<AnalyserRows, void> = {
      id: 'bg',
      version: 1,
      tables: { commandCount: 'replayId' },
      inputs: ['commands'],
      mode: 'background',
      dependsOn: ['ready-a'],
      run: async (ctx) => {
        seen.push('bg-start');
        await gate.promise;
        ctx.progress(1, 2);
        ctx.progress(2, 2);
        return { commandCount: [{ n: (await ctx.read('commands')).length }] };
      },
    };
    const bgFail: Analyser<AnalyserRows, void> = {
      id: 'bg-fail',
      version: 1,
      tables: { never: 'replayId' },
      inputs: [],
      mode: 'background',
      run: () => {
        throw new Error('nope');
      },
    };
    const registry = createRegistry([readyA, readyB, bg, bgFail]);
    const db = await fresh(registry.tables());
    const statuses: IngestStatus[] = [];
    const handle = ingestInline(db, bytes(), {
      fileName: file,
      registry,
      onStatus: (s) => statuses.push(s),
      clock,
      minTickMs: 0,
    });

    const ready = await handle.ready;
    expect(ready.replay.status).toBe('ready');
    expect((await db.replays.get(ready.replayId))?.status).toBe('ready');
    expect(await db.table('playerCount').get(ready.replayId)).toEqual({
      replayId: ready.replayId,
      n: 10,
    });
    expect(await db.table('playerLabel').get(ready.replayId)).toEqual({
      replayId: ready.replayId,
      label: 'players=10',
    });
    expect((await db.analyserRuns.get([ready.replayId, 'ready-a', '-']))?.error).toBeNull();
    expect(await db.analyserRuns.get([ready.replayId, 'bg', '-'])).toBeUndefined();
    expect((await db.ingestJobs.get(ready.jobId))?.status).toBe('ready');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['bg-start']);

    gate.resolve();
    const done = await handle.complete;
    expect(done.replay.status).toBe('complete');
    expect((await db.replays.get(done.replayId))?.status).toBe('complete');
    expect((await db.table('commandCount').get(done.replayId)) as { n: number }).toEqual({
      replayId: done.replayId,
      n: await db.commands.where('replayId').equals(done.replayId).count(),
    });
    expect((await db.analyserRuns.get([done.replayId, 'bg-fail', '-']))?.error).toBe('nope');
    expect(await db.table('never').count()).toBe(0);
    const job = await db.ingestJobs.get(done.jobId);
    expect(job).toMatchObject({ status: 'complete', replayId: done.replayId, fileName: file });
    expect(job?.finishedAt).not.toBeNull();

    const phases = [...new Set(statuses.map((s) => s.phase))];
    expect(phases).toEqual([
      'parsing',
      'normalizing',
      'writing',
      'analysing-ready',
      'analysing-background',
      'complete',
    ]);
    const last = statuses.at(-1)!;
    expect(Object.values(last.sections).every((s) => s.state === 'ok')).toBe(true);
    expect(
      statuses.some(
        (s) =>
          s.sections.trackerEvents.state === 'running' &&
          (s.sections.trackerEvents.current ?? 0) > 0,
      ),
    ).toBe(true);
    expect(last.analysers).toMatchObject({
      'ready-a': { state: 'done', mode: 'ready' },
      'ready-b': { state: 'done', mode: 'ready' },
      bg: { state: 'done', mode: 'background', progress: { current: 2, total: 2 } },
      'bg-fail': { state: 'failed', mode: 'background', error: 'nope' },
    });
    const bgStates = statuses
      .map((s) => s.analysers['bg']?.state)
      .filter((s, i, a) => s !== undefined && a[i - 1] !== s);
    expect(bgStates).toEqual(['queued', 'running', 'done']);
    expect(Object.keys(last.timingsMs).sort()).toEqual([
      'background',
      'normalize',
      'parse',
      'ready',
      'write',
    ]);
    const atReady = statuses.find((s) => s.phase === 'analysing-ready')!;
    expect(atReady.analysers['bg']?.state).toBe('queued');
    expect(last.replayId).toBe(done.replayId);
  });

  it('re-ingesting the same replay replaces it and keeps one replay row', async () => {
    const db = await fresh();
    const a = await ingestInline(db, bytes(), { fileName: file, clock }).complete;
    const b = await ingestInline(db, bytes(), { fileName: file, keepFile: true, clock }).complete;
    expect(b.replayId).toBe(a.replayId);
    expect(await db.replays.count()).toBe(1);
    expect((await db.replays.get(a.replayId))?.hasFile).toBe(true);
    expect(await db.replayFiles.count()).toBe(1);
    expect(await db.ingestJobs.count()).toBe(2);
  });

  it('fails the job on unparseable input and writes nothing', async () => {
    const db = await fresh();
    const statuses: IngestStatus[] = [];
    const handle = ingestInline(db, new Uint8Array([1, 2, 3, 4]), {
      fileName: 'junk',
      onStatus: (s) => statuses.push(s),
      clock,
    });
    await expect(handle.complete).rejects.toThrow(/parse failed/);
    await expect(handle.ready).rejects.toThrow(/parse failed/);
    expect(await db.replays.count()).toBe(0);
    const job = (await db.ingestJobs.toArray())[0]!;
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/^parse failed/);
    expect(statuses.at(-1)?.phase).toBe('failed');
    expect(statuses.at(-1)?.error).toMatch(/^parse failed/);
  });
});

describe.skipIf(replays.length === 0)('lazy analyse', () => {
  const file = replays[0]!;

  it('computes from the store on first request, serves the cache after, recomputes on version bump, and bounds parameterized caches', async () => {
    const calls: unknown[] = [];
    const base: Analyser<AnalyserRows, void> = {
      id: 'base',
      version: 1,
      tables: { baseCount: 'replayId' },
      inputs: ['players'],
      mode: 'lazy',
      run: async (ctx) => {
        calls.push('base');
        return { baseCount: [{ n: (await ctx.read('players')).length }] };
      },
    };
    const heat: Analyser<AnalyserRows, { slot: number }> = {
      id: 'heat',
      version: 1,
      tables: { heatCells: '[replayId+paramsHash+seq], replayId' },
      inputs: ['units'],
      mode: 'lazy',
      dependsOn: ['base'],
      cache: { maxEntries: 2 },
      run: async (ctx, p) => {
        calls.push(p);
        const [b] = await ctx.readTable<{ n: number }>('baseCount');
        const kills = (await ctx.read('units', { killerSlot: p.slot })).length;
        return { heatCells: [{ seq: 0, n: kills + b!.n }] };
      },
    };
    const registry = createRegistry([base, heat as never]);
    const db = await fresh(registry.tables());
    const { replayId } = await ingestInline(db, new Uint8Array(readFileSync(join(LOCAL, file))), {
      fileName: file,
      clock,
    }).complete;

    const first = await analyse(db, replayId, 'heat', { registry, params: { slot: 0 }, clock });
    expect(calls).toEqual(['base', { slot: 0 }]); // dependency resolved lazily first
    expect(first.run.error).toBeNull();
    expect((first.rows['heatCells']![0] as { n: number }).n).toBeGreaterThan(10);
    expect(await db.table('heatCells').count()).toBe(1);

    const again = await analyse(db, replayId, 'heat', { registry, params: { slot: 0 }, clock });
    expect(again).toEqual(first); // cached: same run, rows read back from the table
    expect(calls).toHaveLength(2);

    await analyse(db, replayId, 'heat', { registry, params: { slot: 1 }, clock });
    await analyse(db, replayId, 'heat', { registry, params: { slot: 2 }, clock });
    const runs = await db.analyserRuns
      .where('[replayId+analyserId]')
      .equals([replayId, 'heat'])
      .toArray();
    expect(runs).toHaveLength(2); // maxEntries: the oldest (slot 0) evicted …
    expect(await db.analyserRuns.get([replayId, 'heat', first.run.paramsHash])).toBeUndefined();
    expect(await db.table('heatCells').count()).toBe(2); // … with its rows

    const base2 = { ...base, version: 2 };
    const registry2 = createRegistry([base2, heat as never]);
    calls.length = 0;
    await analyse(db, replayId, 'base', { registry: registry2, clock });
    expect(calls).toEqual(['base']);
    expect((await db.analyserRuns.get([replayId, 'base', '-']))?.analyserVersion).toBe(2);
    expect(await db.table('baseCount').count()).toBe(1); // replaced, not duplicated

    await saveAnalyserOutput(db, base2, {
      run: {
        replayId,
        analyserId: 'base',
        paramsHash: '-',
        analyserVersion: 2,
        error: 'x',
        computedAt: 'x',
        ms: 0,
      },
      rows: {},
    });
    calls.length = 0;
    await analyse(db, replayId, 'base', { registry: registry2, clock });
    expect(calls).toEqual(['base']); // an errored run is not fresh

    await expect(analyse(db, 'nope', 'base', { registry: registry2, clock })).rejects.toThrow(
      /not in the database/,
    );
    await expect(analyse(db, replayId, 'missing', { registry: registry2, clock })).rejects.toThrow(
      /not registered/,
    );
  });
});
