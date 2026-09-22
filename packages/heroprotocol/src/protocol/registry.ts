import type { BuildIndex } from './definition.js';

/**
 * Which protocol a build uses, and which to try when it is unknown.
 *
 * Nearest-lower first: of the 390 published builds, runs of up to 87
 * consecutive builds share one definition, so an unpublished build almost
 * always belongs to the run just below it. Nearest-higher is the second guess.
 * Three candidates in total — the evidence says more buy nothing.
 */
export class ProtocolRegistry {
  private readonly index = new Map<number, number>();
  private readonly representatives: number[];

  public constructor(index: BuildIndex) {
    for (const [build, rep] of Object.entries(index)) this.index.set(Number(build), rep);
    this.representatives = [...new Set(this.index.values())].sort((a, b) => a - b);
  }

  /** The representative build for an exactly-known build, else undefined. */
  public exact(build: number): number | undefined {
    return this.index.get(build);
  }

  public get newest(): number {
    return this.representatives[this.representatives.length - 1] ?? 0;
  }

  public get oldest(): number {
    return this.representatives[0] ?? 0;
  }

  /** Representative builds to try for `build`, in order; at most three, no repeats. */
  public candidates(build: number): number[] {
    const out: number[] = [];
    const push = (b: number | undefined): void => {
      if (b !== undefined && !out.includes(b)) out.push(b);
    };
    push(this.exact(build));
    push(this.nearestLower(build));
    push(this.nearestHigher(build));
    return out;
  }

  /** Whether the build is one this registry knows an exact protocol for. */
  public has(build: number): boolean {
    return this.index.has(build);
  }

  /** Add builds learned later (e.g. from a fresh upstream tree listing). */
  public learn(index: BuildIndex): void {
    for (const [build, rep] of Object.entries(index)) {
      this.index.set(Number(build), rep);
      if (!this.representatives.includes(rep)) {
        this.representatives.push(rep);
        this.representatives.sort((a, b) => a - b);
      }
    }
  }

  private nearestLower(build: number): number | undefined {
    let best: { known: number; rep: number } | undefined;
    for (const [known, rep] of this.index) {
      if (known <= build && (best === undefined || known > best.known)) best = { known, rep };
    }
    return best?.rep;
  }

  private nearestHigher(build: number): number | undefined {
    let best: { known: number; rep: number } | undefined;
    for (const [known, rep] of this.index) {
      if (known >= build && (best === undefined || known < best.known)) best = { known, rep };
    }
    return best?.rep;
  }
}
