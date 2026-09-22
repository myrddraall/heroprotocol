import type { NormalizedReplay, RecordOf, ReplayCollectionName } from '../model/records.js';
import { statSupportFor } from './statSupport.js';
import type { AnalyserContext, StatSupportTable, Where } from './types.js';

export interface ContextOptions {
  readonly results?: Readonly<Record<string, unknown>>;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly statSupport?: StatSupportTable;
  readonly onProgress?: (current: number, total: number) => void;
}

/** Equality filter shared by every `read()` implementation. */
export function matches<K extends ReplayCollectionName>(
  row: RecordOf<K>,
  where: Where<K> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if ((row as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

/**
 * An `AnalyserContext` over an in-memory normalized replay — what ingest-time
 * analysers run against, and what tests use.
 */
export function createMemoryContext(
  normalized: NormalizedReplay,
  options: ContextOptions = {},
): AnalyserContext {
  const statSupport =
    options.statSupport ??
    statSupportFor({
      baseBuild: normalized.replay.version.baseBuild,
      hasScoreResults: normalized.scoreResults.length > 0,
    });
  return {
    replay: normalized.replay,
    results: options.results ?? {},
    services: options.services ?? {},
    statSupport,
    read<K extends ReplayCollectionName>(
      collection: K,
      where?: Where<K>,
    ): Promise<readonly RecordOf<K>[]> {
      const rows = normalized[collection] as readonly RecordOf<K>[];
      return Promise.resolve(where ? rows.filter((r) => matches(r, where)) : rows);
    },
    progress(current: number, total: number): void {
      options.onProgress?.(current, total);
    },
  };
}

/** The same context with a different `results` map — one per analyser in a run. */
export function withResults(
  ctx: AnalyserContext,
  results: Readonly<Record<string, unknown>>,
  onProgress?: (c: number, t: number) => void,
): AnalyserContext {
  return {
    replay: ctx.replay,
    results,
    services: ctx.services,
    statSupport: ctx.statSupport,
    read: (collection, where) => ctx.read(collection, where),
    progress(current, total) {
      onProgress?.(current, total);
      ctx.progress(current, total);
    },
  };
}
