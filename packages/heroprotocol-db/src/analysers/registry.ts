import type {
  Analyser,
  AnalyserMode,
  AnalyserRegistration,
  AnalyserRows,
  AnyAnalyser,
  RegisterOptions,
} from './types.js';
import { MODE_ORDER } from './types.js';

export class AnalyserRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyserRegistrationError';
  }
}

/** Core store names an analyser may not reuse. */
export const RESERVED_TABLES: ReadonlySet<string> = new Set([
  'replays',
  'players',
  'scoreResults',
  'statEvents',
  'units',
  'commands',
  'events',
  'chat',
  'analyserRuns',
  'replayFiles',
  'ingestJobs',
  'meta',
]);

/** The primary key of a Dexie schema string: the first comma-separated spec. */
export function primaryKeyOf(schema: string): string {
  return schema.split(',')[0]!.trim();
}

/** Whether a primary key starts with `replayId`: `replayId`, `[replayId+…]`. */
export function keyStartsWithReplayId(primaryKey: string): boolean {
  const key = primaryKey.replace(/^&/, '');
  return key === 'replayId' || key.startsWith('[replayId+');
}

/**
 * The set of analysers a host runs. Registration is by id (duplicates are an error),
 * modes may be overridden per host, table names are checked for uniqueness and for a
 * `replayId`-first primary key, and `validate()` checks the dependency graph: every
 * dependency registered, no cycles, and no analyser depending on one that runs later.
 */
export class AnalyserRegistry {
  private readonly entries = new Map<string, AnalyserRegistration>();
  private readonly tableOwners = new Map<string, string>();

  register<T extends AnalyserRows, P>(
    analyser: Analyser<T, P>,
    options: RegisterOptions = {},
  ): this {
    if (this.entries.has(analyser.id)) {
      throw new AnalyserRegistrationError(`analyser '${analyser.id}' is already registered`);
    }
    for (const [table, schema] of Object.entries(analyser.tables)) {
      if (RESERVED_TABLES.has(table)) {
        throw new AnalyserRegistrationError(
          `analyser '${analyser.id}' declares table '${table}', which is a core table`,
        );
      }
      const owner = this.tableOwners.get(table);
      if (owner !== undefined) {
        throw new AnalyserRegistrationError(
          `analyser '${analyser.id}' declares table '${table}', already declared by '${owner}'`,
        );
      }
      if (!keyStartsWithReplayId(primaryKeyOf(schema))) {
        throw new AnalyserRegistrationError(
          `analyser '${analyser.id}' table '${table}': primary key must start with replayId (got '${primaryKeyOf(schema)}')`,
        );
      }
    }
    for (const table of Object.keys(analyser.tables)) this.tableOwners.set(table, analyser.id);
    this.entries.set(analyser.id, {
      analyser: analyser as AnyAnalyser,
      mode: options.mode ?? analyser.mode,
    });
    return this;
  }

  get(id: string): AnalyserRegistration | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Registrations, optionally of one mode, in registration order. */
  list(mode?: AnalyserMode): AnalyserRegistration[] {
    const all = [...this.entries.values()];
    return mode === undefined ? all : all.filter((r) => r.mode === mode);
  }

  /** Every analyser table with its schema — what the database adds to the core stores. */
  tables(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { analyser } of this.entries.values()) Object.assign(out, analyser.tables);
    return out;
  }

  /** Which analyser declared a table. */
  ownerOf(table: string): string | undefined {
    return this.tableOwners.get(table);
  }

  /** Throws `AnalyserRegistrationError` describing the first problem found. */
  validate(): void {
    for (const { analyser, mode } of this.entries.values()) {
      for (const dep of analyser.dependsOn ?? []) {
        const target = this.entries.get(dep);
        if (!target) {
          throw new AnalyserRegistrationError(
            `analyser '${analyser.id}' depends on '${dep}', which is not registered`,
          );
        }
        if (MODE_ORDER[target.mode] > MODE_ORDER[mode]) {
          throw new AnalyserRegistrationError(
            `analyser '${analyser.id}' (${mode}) depends on '${dep}' (${target.mode}), which runs later`,
          );
        }
      }
    }
    this.order([...this.entries.keys()]); // detects cycles
  }

  /**
   * The given analysers plus their transitive dependencies, in an order where every
   * dependency precedes its dependents. Throws on a cycle.
   */
  order(ids: readonly string[]): AnalyserRegistration[] {
    const out: AnalyserRegistration[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, path: string[]): void => {
      const s = state.get(id);
      if (s === 'done') return;
      if (s === 'visiting') {
        throw new AnalyserRegistrationError(
          `analyser dependency cycle: ${[...path, id].join(' → ')}`,
        );
      }
      const reg = this.entries.get(id);
      if (!reg) throw new AnalyserRegistrationError(`analyser '${id}' is not registered`);
      state.set(id, 'visiting');
      for (const dep of reg.analyser.dependsOn ?? []) visit(dep, [...path, id]);
      state.set(id, 'done');
      out.push(reg);
    };
    for (const id of ids) visit(id, []);
    return out;
  }
}

export function createRegistry(analysers: readonly AnyAnalyser[] = []): AnalyserRegistry {
  const registry = new AnalyserRegistry();
  for (const a of analysers) registry.register(a);
  return registry;
}
