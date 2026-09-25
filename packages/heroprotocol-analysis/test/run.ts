import {
  analyse,
  createDbContext,
  createMemoryContext,
  createRegistry,
  HeroDb,
  paramsHash,
  runAnalyser,
  runAnalysers,
  TableSink,
  writeReplay,
  type AnalyserRegistry,
  type NormalizedReplay,
} from '@myrddraall/heroprotocol-db';
import { builtins } from '../src/builtins.js';
import { commands } from '../src/analysers/commands.js';
import { deathHeatmap, type DeathHeatmapParams } from '../src/analysers/deathHeatmap.js';

/** The parameter sets the goldens and parity tests use for the heatmap. */
export const HEATMAP_PARAMS: readonly (DeathHeatmapParams | undefined)[] = [
  undefined,
  { team: 0 },
  { slot: 3, cell: 16 },
  { killerSlot: 0 },
];

/** Every built-in's rows, keyed `analyserId` (lazy parameterized ones `analyserId#paramsHash`), then by table. */
export type Results = Record<string, Record<string, readonly object[]>>;

export function registry(): AnalyserRegistry {
  return createRegistry(builtins);
}

/** Every built-in at ingest: ready + background over the in-memory replay, lazy ones run directly. */
export async function runInMemory(n: NormalizedReplay): Promise<Results> {
  const reg = registry();
  const sink = new TableSink();
  const ctx = createMemoryContext(n, { tables: sink });
  const out: Results = {};
  const { computed } = await runAnalysers({
    registry: reg,
    ctx,
    modes: ['ready', 'background'],
    sink,
  });
  for (const o of computed) {
    if (o.run.error !== null) throw new Error(`${o.run.analyserId}: ${o.run.error}`);
    out[o.run.analyserId] = o.rows;
  }
  out[commands.id] = (await runAnalyser(commands as never, ctx, undefined)).rows;
  for (const params of HEATMAP_PARAMS) {
    const o = await runAnalyser(deathHeatmap as never, ctx, params);
    out[`${deathHeatmap.id}#${paramsHash(params)}`] = o.rows;
  }
  return out;
}

/** The same set through the store: written to Dexie, ready + background over a db context, lazy via analyse(). */
export async function runFromStore(
  n: NormalizedReplay,
  dbName: string,
): Promise<{ results: Results; db: HeroDb }> {
  const reg = registry();
  const db = await HeroDb.open(dbName, reg.tables());
  await writeReplay(db, n, { status: 'ready' });
  const replay = (await db.replays.get(n.replay.id))!;
  const out: Results = {};
  const { computed } = await runAnalysers({
    registry: reg,
    ctx: await createDbContext(db, replay),
    modes: ['ready', 'background'],
    onComputed: async (o) => {
      const { saveAnalyserOutput } = await import('@myrddraall/heroprotocol-db');
      await saveAnalyserOutput(db, reg.get(o.run.analyserId)!.analyser, o);
    },
  });
  for (const o of computed) {
    if (o.run.error !== null) throw new Error(`${o.run.analyserId}: ${o.run.error}`);
    out[o.run.analyserId] = o.rows;
  }
  out[commands.id] = (await analyse(db, n.replay.id, commands.id, { registry: reg })).rows;
  for (const params of HEATMAP_PARAMS) {
    const o = await analyse(db, n.replay.id, deathHeatmap.id, { registry: reg, params });
    out[`${deathHeatmap.id}#${o.run.paramsHash}`] = o.rows;
  }
  return { results: out, db };
}
