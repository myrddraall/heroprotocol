import type { NormalizedReplay, RecordOf, ReplayCollectionName } from '../model/records.js';
import { statSupportFor } from './statSupport.js';
import type { AnalyserContext, AnalyserRow, StatSupportTable, Where } from './types.js';

export interface ContextOptions {
  readonly services?: Readonly<Record<string, unknown>>;
  readonly statSupport?: StatSupportTable;
  readonly onProgress?: (current: number, total: number) => void;
  /** Analyser rows already available (a dependency's output), by table. */
  readonly tables?: TableSink;
}

/** Equality filter shared by every `read()` implementation. */
export function matches<T>(row: T, where: Where<T> | undefined): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if ((row as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

/**
 * Rows analysers produced during one ingest, by table, so later analysers can read
 * them through `ctx.readTable()` before anything is written to the store.
 */
export class TableSink {
  private readonly rows = new Map<string, AnalyserRow[]>();

  add(table: string, rows: readonly AnalyserRow[]): void {
    const list = this.rows.get(table) ?? [];
    list.push(...rows);
    this.rows.set(table, list);
  }

  get(table: string): readonly AnalyserRow[] {
    return this.rows.get(table) ?? [];
  }

  tables(): string[] {
    return [...this.rows.keys()];
  }
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
  const sink = options.tables ?? new TableSink();
  return {
    replay: normalized.replay,
    services: options.services ?? {},
    statSupport,
    read<K extends ReplayCollectionName>(
      collection: K,
      where?: Where<RecordOf<K>>,
    ): Promise<readonly RecordOf<K>[]> {
      const rows = normalized[collection] as readonly RecordOf<K>[];
      return Promise.resolve(where ? rows.filter((r) => matches(r, where)) : rows);
    },
    readTable<T extends object>(table: string, where?: Where<T>): Promise<readonly T[]> {
      const rows = sink.get(table) as readonly T[];
      return Promise.resolve(where ? rows.filter((r) => matches(r, where)) : rows);
    },
    progress(current: number, total: number): void {
      options.onProgress?.(current, total);
    },
  };
}

/** The same context with a different progress sink — one per analyser in a run. */
export function withProgress(
  ctx: AnalyserContext,
  onProgress: (c: number, t: number) => void,
): AnalyserContext {
  return {
    replay: ctx.replay,
    services: ctx.services,
    statSupport: ctx.statSupport,
    read: (collection, where) => ctx.read(collection, where),
    readTable: (table, where) => ctx.readTable(table, where),
    progress(current, total) {
      onProgress(current, total);
      ctx.progress(current, total);
    },
  };
}
