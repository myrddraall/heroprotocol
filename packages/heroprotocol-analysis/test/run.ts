import {
  analyse,
  createDbContext,
  createMemoryContext,
  createRegistry,
  HeroDb,
  NO_PARAMS,
  paramsHash,
  runAnalyser,
  runAnalysers,
  writeReplay,
  type AnalyserRegistry,
  type NormalizedReplay,
} from '@myrddraall/heroprotocol-db';
import { builtins } from '../src/builtins.js';
import { deathHeatmap, type DeathHeatmapParams } from '../src/analysers/deathHeatmap.js';

/** The parameter sets the goldens and parity tests use for the lazy analysers. */
export const HEATMAP_PARAMS: readonly (DeathHeatmapParams | undefined)[] = [
  undefined,
  { team: 0 },
  { slot: 3, cell: 16 },
  { killerSlot: 0 },
];

export const LAZY_IDS: readonly string[] = ['@myrddraall/commands', '@myrddraall/death-heatmap'];

export function registry(): AnalyserRegistry {
  return createRegistry(builtins);
}

/** Every built-in at ingest: ready + background over the in-memory replay, lazy ones run directly. */
export async function runInMemory(n: NormalizedReplay): Promise<Record<string, unknown>> {
  const reg = registry();
  const ctx = createMemoryContext(n);
  const out: Record<string, unknown> = {};
  const { computed } = await runAnalysers({ registry: reg, ctx, modes: ['ready', 'background'] });
  for (const row of computed) {
    if (row.error !== null) throw new Error(`${row.analyserId}: ${row.error}`);
    out[row.analyserId] = row.result;
  }
  const cmd = await runAnalyser(reg.get('@myrddraall/commands')!.analyser, ctx, undefined);
  out['@myrddraall/commands'] = cmd.result;
  for (const params of HEATMAP_PARAMS) {
    const row = await runAnalyser(deathHeatmap as never, ctx, params);
    out[`@myrddraall/death-heatmap#${paramsHash(params)}`] = row.result;
  }
  return out;
}

/** The same set through the store: written to Dexie, ready + background over a db context, lazy via analyse(). */
export async function runFromStore(
  n: NormalizedReplay,
  dbName: string,
): Promise<{ results: Record<string, unknown>; db: HeroDb }> {
  const reg = registry();
  const db = new HeroDb(dbName);
  await writeReplay(db, n, { status: 'ready' });
  const replay = (await db.replays.get(n.replay.id))!;
  const out: Record<string, unknown> = {};
  const { computed } = await runAnalysers({
    registry: reg,
    ctx: await createDbContext(db, replay),
    modes: ['ready', 'background'],
  });
  for (const row of computed) {
    if (row.error !== null) throw new Error(`${row.analyserId}: ${row.error}`);
    out[row.analyserId] = row.result;
  }
  out['@myrddraall/commands'] = (
    await analyse(db, n.replay.id, '@myrddraall/commands', { registry: reg })
  ).result;
  for (const params of HEATMAP_PARAMS) {
    const row = await analyse(db, n.replay.id, '@myrddraall/death-heatmap', {
      registry: reg,
      params,
    });
    out[`@myrddraall/death-heatmap#${row.paramsHash}`] = row.result;
  }
  void NO_PARAMS;
  return { results: out, db };
}
