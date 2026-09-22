import type { SectionName, SectionStatus } from '@myrddraall/heroprotocol';
import { ALL_SECTIONS } from '@myrddraall/heroprotocol';
import type { AnalyserMode, AnalyserState, AnalyserStatus } from '../analysers/types.js';

export type IngestPhase =
  | 'parsing'
  | 'normalizing'
  | 'writing'
  | 'analysing-ready'
  | 'analysing-background'
  | 'analysing-lazy'
  | 'complete'
  | 'failed';

export type SectionState = 'pending' | 'running' | SectionStatus;

export interface SectionProgress {
  readonly state: SectionState;
  readonly current?: number;
  readonly total?: number;
}

export interface AnalyserProgress {
  readonly state: AnalyserState;
  readonly mode: AnalyserMode;
  readonly ms?: number;
  readonly error?: string;
  readonly progress?: { readonly current: number; readonly total: number };
}

export type IngestTiming = 'parse' | 'normalize' | 'write' | 'ready' | 'background';

/**
 * One snapshot of an ingest job: the replay level (phase, per-section progress) and
 * the analyser level (per-analyser state), posted on every transition and at a
 * bounded rate during long phases. Only coarse state is ever persisted; this stream
 * is the fine-grained view.
 */
export interface IngestStatus {
  readonly jobId: number;
  readonly fileName: string;
  readonly replayId: string | null;
  readonly phase: IngestPhase;
  readonly sections: Readonly<Record<SectionName, SectionProgress>>;
  readonly analysers: Readonly<Record<string, AnalyserProgress>>;
  readonly timingsMs: Readonly<Partial<Record<IngestTiming, number>>>;
  readonly error?: string;
}

export interface StatusTrackerOptions {
  readonly jobId: number;
  readonly fileName: string;
  readonly onStatus?: ((status: IngestStatus) => void) | undefined;
  /** Milliseconds clock, for throttling progress ticks. */
  readonly ms: () => number;
  /** Minimum gap between two progress-only snapshots (default 33 ms ≈ 30 Hz). */
  readonly minTickMs?: number;
}

/** Builds and emits `IngestStatus` snapshots; transitions always emit, ticks are throttled. */
export class StatusTracker {
  private phase: IngestPhase = 'parsing';
  private replayId: string | null = null;
  private error: string | undefined;
  private readonly sections: Record<SectionName, SectionProgress>;
  private readonly analysers: Record<string, AnalyserProgress> = {};
  private readonly timings: Partial<Record<IngestTiming, number>> = {};
  private lastTick = -Infinity;
  private readonly minTickMs: number;

  constructor(private readonly options: StatusTrackerOptions) {
    this.minTickMs = options.minTickMs ?? 33;
    this.sections = Object.fromEntries(
      ALL_SECTIONS.map((s) => [s, { state: 'pending' }]),
    ) as Record<SectionName, SectionProgress>;
  }

  snapshot(): IngestStatus {
    return {
      jobId: this.options.jobId,
      fileName: this.options.fileName,
      replayId: this.replayId,
      phase: this.phase,
      sections: { ...this.sections },
      analysers: { ...this.analysers },
      timingsMs: { ...this.timings },
      ...(this.error !== undefined ? { error: this.error } : {}),
    };
  }

  setPhase(phase: IngestPhase): void {
    this.phase = phase;
    this.emit();
  }

  setReplayId(id: string): void {
    this.replayId = id;
  }

  timing(name: IngestTiming, ms: number): void {
    this.timings[name] = ms;
  }

  fail(error: string): void {
    this.error = error;
    this.phase = 'failed';
    this.emit();
  }

  /** A parser progress tick: the first tick of a section marks it running. */
  sectionProgress(section: SectionName, current: number, total: number): void {
    this.sections[section] = { state: 'running', current, total };
    this.tick();
  }

  /** Final per-section outcomes from the parser's diagnostics. */
  sectionsDone(statuses: Readonly<Record<SectionName, SectionStatus>>): void {
    for (const [name, status] of Object.entries(statuses) as [SectionName, SectionStatus][]) {
      const prev = this.sections[name];
      this.sections[name] = {
        state: status,
        ...(prev.total !== undefined ? { current: prev.total, total: prev.total } : {}),
      };
    }
    this.emit();
  }

  analyser(status: AnalyserStatus): void {
    const prev = this.analysers[status.analyserId];
    // A later phase satisfying a dependency from this job's own rows reports it as
    // `cached`; within one job that analyser already ran, so keep its `done`.
    if (status.state === 'cached' && prev?.state === 'done') return;
    const isTick =
      status.state === 'running' && status.progress !== undefined && prev?.state === 'running';
    this.analysers[status.analyserId] = {
      state: status.state,
      mode: status.mode,
      ...(status.ms !== undefined ? { ms: status.ms } : {}),
      ...(status.error !== undefined ? { error: status.error } : {}),
      ...(status.progress !== undefined
        ? { progress: status.progress }
        : prev?.progress !== undefined
          ? { progress: prev.progress }
          : {}),
    };
    if (isTick) this.tick();
    else this.emit();
  }

  /** Register analysers as queued before any runs, so the UI can show the full list. */
  queue(ids: readonly string[], mode: AnalyserMode): void {
    for (const id of ids) this.analysers[id] ??= { state: 'queued', mode };
  }

  private tick(): void {
    const now = this.options.ms();
    if (now - this.lastTick < this.minTickMs) return;
    this.emit();
  }

  private emit(): void {
    this.lastTick = this.options.ms();
    this.options.onStatus?.(this.snapshot());
  }
}
