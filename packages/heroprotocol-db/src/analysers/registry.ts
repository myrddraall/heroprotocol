import type { AnalyserMode, AnalyserRegistration, AnyAnalyser, RegisterOptions } from './types.js';
import { MODE_ORDER } from './types.js';

export class AnalyserRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyserRegistrationError';
  }
}

/**
 * The set of analysers a host runs. Registration is by id (duplicates are an
 * error), modes may be overridden per host, and `validate()` checks the dependency
 * graph: every dependency registered, no cycles, and no analyser depending on one
 * that runs later than itself (`ready` → `background` is forbidden; the reverse is fine).
 */
export class AnalyserRegistry {
  private readonly entries = new Map<string, AnalyserRegistration>();

  register<T, P>(
    analyser: import('./types.js').Analyser<T, P>,
    options: RegisterOptions = {},
  ): this {
    if (this.entries.has(analyser.id)) {
      throw new AnalyserRegistrationError(`analyser '${analyser.id}' is already registered`);
    }
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
