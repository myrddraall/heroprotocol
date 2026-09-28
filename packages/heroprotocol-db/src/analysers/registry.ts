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
 * dependency registered and no cycles.
 *
 * A dependency may be in a later mode than its dependent (a `ready` analyser reading a
 * `lazy` one's table). The dependency is then pulled forward: its effective `mode` becomes
 * the earliest mode of anything that depends on it, so it runs, automatically and first,
 * in the same stage. `declaredMode` keeps what it asked for.
 */
export class AnalyserRegistry {
  private readonly entries = new Map<string, AnalyserRegistration>();
  private readonly tableOwners = new Map<string, string>();
  private effective: Map<string, AnalyserRegistration> | null = null;

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
    const mode = options.mode ?? analyser.mode;
    this.entries.set(analyser.id, {
      analyser: analyser as AnyAnalyser,
      mode,
      declaredMode: mode,
    });
    this.effective = null;
    return this;
  }

  /** Registrations with dependencies pulled forward to the earliest mode that needs them. */
  private resolved(): Map<string, AnalyserRegistration> {
    if (this.effective) return this.effective;
    const modes = new Map<string, AnalyserMode>();
    for (const [id, reg] of this.entries) modes.set(id, reg.declaredMode);
    // Modes only move earlier, so this settles (cycles included; validate() reports those).
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, reg] of this.entries) {
        const mine = modes.get(id)!;
        for (const dep of reg.analyser.dependsOn ?? []) {
          const theirs = modes.get(dep);
          if (theirs !== undefined && MODE_ORDER[theirs] > MODE_ORDER[mine]) {
            modes.set(dep, mine);
            changed = true;
          }
        }
      }
    }
    const out = new Map<string, AnalyserRegistration>();
    for (const [id, reg] of this.entries) out.set(id, { ...reg, mode: modes.get(id)! });
    this.effective = out;
    return out;
  }

  get(id: string): AnalyserRegistration | undefined {
    return this.resolved().get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Registrations, optionally of one (effective) mode, in registration order. */
  list(mode?: AnalyserMode): AnalyserRegistration[] {
    const all = [...this.resolved().values()];
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
    for (const { analyser } of this.entries.values()) {
      for (const dep of analyser.dependsOn ?? []) {
        if (!this.entries.has(dep)) {
          throw new AnalyserRegistrationError(
            `analyser '${analyser.id}' depends on '${dep}', which is not registered`,
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
      const reg = this.get(id);
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
