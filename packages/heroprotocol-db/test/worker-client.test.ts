import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Analyser } from '../src/analysers/types.js';
import { createReplayDb } from '../src/client/createReplayDb.js';
import type { ReplayDbClient } from '../src/client/createReplayDb.js';
import type { IngestStatus } from '../src/ingest/status.js';
import { createWorker } from '../src/worker/createWorker.js';
import type { WorkerHandle } from '../src/worker/createWorker.js';
import type { WorkerLike, WorkerScope } from '../src/worker/protocol.js';
import { LOCAL, localReplays } from './util/node.js';

/**
 * The real client talking to the real worker code over a Node MessageChannel —
 * the same protocol a browser `Worker` carries, including buffer transfer.
 */
const replays = localReplays();
const file = replays[0]!;
const bytes = () => new Uint8Array(readFileSync(join(LOCAL, file)));

const heroCount: Analyser<number> = {
  id: 'example/hero-count',
  version: 1,
  inputs: ['units'],
  mode: 'ready',
  run: async (ctx) => (await ctx.read('units', { unitClass: 'hero' })).length,
};
const commandsPer: Analyser<Record<number, number>> = {
  id: 'example/commands-per-player',
  version: 1,
  inputs: ['commands'],
  mode: 'background',
  run: async (ctx) => {
    const out: Record<number, number> = {};
    for (const c of await ctx.read('commands')) out[c.playerSlot] = (out[c.playerSlot] ?? 0) + 1;
    return out;
  },
};
const withService: Analyser<string, { greet: string }> = {
  id: 'example/service',
  version: 1,
  inputs: [],
  mode: 'lazy',
  run: (ctx, p) => `${p.greet} ${(ctx.services['name'] as string) ?? '?'}`,
};

let handle: WorkerHandle | undefined;
let client: ReplayDbClient | undefined;
let n = 0;
afterEach(async () => {
  await client?.close();
  await handle?.dispose();
  client = undefined;
  handle = undefined;
});

function pair(): { scope: WorkerScope; worker: WorkerLike } {
  const channel = new MessageChannel();
  return {
    scope: channel.port1 as unknown as WorkerScope,
    worker: channel.port2 as unknown as WorkerLike,
  };
}

describe.skipIf(replays.length === 0)('client ↔ worker over a message channel', () => {
  it('ingests through the worker, streams status, resolves ready then complete, and the main-thread db sees the rows', async () => {
    const { scope, worker } = pair();
    handle = createWorker(
      {
        analysers: [
          heroCount,
          { analyser: commandsPer, options: { mode: 'background' } },
          withService as never,
        ],
        services: { name: 'nexus' },
      },
      scope,
    );
    client = createReplayDb({ dbName: `wc-${n++}`, worker });
    const analysers = await client.ready;
    expect(analysers).toEqual([
      { id: 'example/hero-count', mode: 'ready', version: 1 },
      { id: 'example/commands-per-player', mode: 'background', version: 1 },
      { id: 'example/service', mode: 'lazy', version: 1 },
    ]);

    const statuses: IngestStatus[] = [];
    const data = bytes();
    const job = client.ingest(data, { fileName: file, onStatus: (s) => statuses.push(s) });
    expect(data.byteLength).toBe(0); // the buffer was transferred, not copied
    const late: IngestStatus[] = [];
    const unsubscribe = job.status((s) => late.push(s));

    const ready = await job.ready;
    expect(ready.replay.status).toBe('ready');
    expect(job.latest?.replayId).toBe(ready.replayId);
    // the client's own Dexie instance (same database name) sees what the worker wrote
    expect((await client.db.replays.get(ready.replayId))?.status).toBe('ready');
    expect((await client.db.derived.get([ready.replayId, 'example/hero-count', '-']))?.result).toBe(
      10,
    );

    const done = await job.complete;
    unsubscribe();
    expect(done.replay.status).toBe('complete');
    expect((await client.db.replays.get(done.replayId))?.status).toBe('complete');
    const per = (await client.db.derived.get([done.replayId, 'example/commands-per-player', '-']))
      ?.result as Record<number, number>;
    expect(Object.keys(per)).toHaveLength(10);
    expect(Object.values(per).reduce((a, b) => a + b, 0)).toBe(
      await client.db.commands.where('replayId').equals(done.replayId).count(),
    );

    const phases = [...new Set(statuses.map((s) => s.phase))];
    expect(phases).toEqual([
      'parsing',
      'normalizing',
      'writing',
      'analysing-ready',
      'analysing-background',
      'complete',
    ]);
    expect(late.length).toBeGreaterThan(0);
    expect(statuses.at(-1)?.analysers['example/commands-per-player']?.state).toBe('done');
    expect((await client.listReplays()).map((r) => r.id)).toEqual([done.replayId]);
  });

  it('runs lazy analysers with params and services, reanalyses, and reports failures as rejections', async () => {
    const { scope, worker } = pair();
    handle = createWorker(
      { analysers: [heroCount, withService as never], services: { name: 'nexus' } },
      scope,
    );
    client = createReplayDb({ dbName: `wc-${n++}`, worker });
    const { replayId } = await client.ingest(bytes(), { fileName: file }).complete;

    const seen: string[] = [];
    const row = await client.analyse(replayId, 'example/service', {
      params: { greet: 'hello' },
      onStatus: (s) => seen.push(s.state),
    });
    expect(row.result).toBe('hello nexus');
    expect(seen).toEqual(['running', 'done']);
    const again = await client.analyse(replayId, 'example/service', {
      params: { greet: 'hello' },
      onStatus: (s) => seen.push(s.state),
    });
    expect(again).toEqual(row);
    expect(seen.at(-1)).toBe('cached');
    const both = await client.analyseAll(replayId, ['example/hero-count', 'example/service'], {
      params: { greet: 'hi' },
    });
    expect(both.map((r) => r.result)).toEqual([10, 'hi nexus']);

    await client.db.derived.delete([replayId, 'example/hero-count', '-']);
    const recomputed = await client.reanalyse(replayId);
    expect(recomputed.map((r) => r.analyserId)).toEqual(['example/hero-count']);

    await expect(client.analyse(replayId, 'nope')).rejects.toThrow(/not registered/);
    await expect(client.analyse('missing', 'example/hero-count')).rejects.toThrow(
      /not in the database/,
    );
    const bad = client.ingest(new Uint8Array([1, 2, 3]), { fileName: 'junk' });
    await expect(bad.complete).rejects.toThrow(/parse failed/);
    await expect(bad.ready).rejects.toThrow(/parse failed/);
  });

  it('inline mode runs the same pipeline on the calling thread', async () => {
    client = createReplayDb({ dbName: `wc-${n++}`, inline: true, analysers: [heroCount] });
    expect(await client.ready).toEqual([{ id: 'example/hero-count', mode: 'ready', version: 1 }]);
    const statuses: IngestStatus[] = [];
    const job = client.ingest(bytes(), { fileName: file, onStatus: (s) => statuses.push(s) });
    const done = await job.complete;
    expect(statuses.at(-1)?.phase).toBe('complete');
    expect((await client.db.derived.get([done.replayId, 'example/hero-count', '-']))?.result).toBe(
      10,
    );
    expect(await client.pruneReplays(0)).toEqual([done.replayId]);
    expect(await client.db.replays.count()).toBe(0);
  });

  it('refuses a client with nowhere to run', () => {
    expect(() => createReplayDb({ dbName: 'nowhere' })).toThrow(/worker|inline/);
  });
});
