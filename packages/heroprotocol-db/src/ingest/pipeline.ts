import type { ParsedReplay, ProtocolSource } from '@myrddraall/heroprotocol';
import { NOISY_GAME_EVENTS, openReplay } from '@myrddraall/heroprotocol';
import { createMemoryContext } from '../analysers/context.js';
import { createRegistry, type AnalyserRegistry } from '../analysers/registry.js';
import { runAnalysers, systemClock } from '../analysers/runner.js';
import type { RunClock } from '../analysers/types.js';
import { saveDerived } from '../db/derived.js';
import type { HeroDb } from '../db/HeroDb.js';
import { setReplayStatus, writeReplay } from '../db/write.js';
import type { NormalizedReplay, ReplayRecord } from '../model/records.js';
import { normalizeReplay } from '../normalize/normalizeReplay.js';
import { StatusTracker, type IngestStatus } from './status.js';

export interface IngestOptions {
  readonly fileName: string;
  /** Analysers to run at ingest; none by default. */
  readonly registry?: AnalyserRegistry;
  /** Keep the raw bytes in `replayFiles` (default false). */
  readonly keepFile?: boolean;
  readonly onStatus?: (status: IngestStatus) => void;
  /** Protocol source for the parser; default bundled definitions. */
  readonly source?: ProtocolSource;
  /** Game events to decode but drop; default `NOISY_GAME_EVENTS`. */
  readonly dropGameEvents?: ReadonlySet<string>;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly clock?: RunClock;
  /** Throttle for progress snapshots, ms. */
  readonly minTickMs?: number;
}

export interface IngestResult {
  readonly jobId: number;
  readonly replayId: string;
  readonly replay: ReplayRecord;
  readonly status: IngestStatus;
}

export interface IngestHandle {
  /** Resolves once the replay is written and its `ready` analysers are committed. */
  readonly ready: Promise<IngestResult>;
  /** Resolves once the `background` analysers are committed too. */
  readonly complete: Promise<IngestResult>;
}

/**
 * The ingest pipeline, in-thread. The worker (Stage 4) runs exactly this.
 *
 * 1. parse (best-effort, per-section progress)      → phase `parsing`
 * 2. normalize                                       → `normalizing`
 * 3. commit 1: every collection, status `analysing`  → `writing`
 * 4. `ready` analysers over the in-memory model, commit 2 with status `ready`;
 *    `ready` resolves                                → `analysing-ready`
 * 5. `background` analysers, each committed as it finishes; status `complete`
 *                                                    → `analysing-background`
 * A parse or write failure fails the job; an analyser failure is only an error row.
 */
export function ingestInline(
  db: HeroDb,
  bytes: Uint8Array | ArrayBuffer,
  options: IngestOptions,
): IngestHandle {
  let resolveReady!: (r: IngestResult) => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<IngestResult>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  // A consumer may await only `complete`; a `ready` rejection must not surface as unhandled.
  ready.catch(() => undefined);
  const complete = runPipeline(db, bytes, options, resolveReady).catch((err: unknown) => {
    rejectReady(err);
    throw err;
  });
  return { ready, complete };
}

async function runPipeline(
  db: HeroDb,
  bytes: Uint8Array | ArrayBuffer,
  options: IngestOptions,
  resolveReady: (r: IngestResult) => void,
): Promise<IngestResult> {
  const clock = options.clock ?? systemClock;
  const registry = options.registry ?? createRegistry();
  registry.validate();

  const jobId = (await db.ingestJobs.add({
    replayId: null,
    fileName: options.fileName,
    status: 'running',
    startedAt: clock.now(),
    finishedAt: null,
    error: null,
  })) as number;
  const tracker = new StatusTracker({
    jobId,
    fileName: options.fileName,
    onStatus: options.onStatus,
    ms: () => clock.ms(),
    ...(options.minTickMs !== undefined ? { minTickMs: options.minTickMs } : {}),
  });
  const failJob = async (error: string): Promise<void> => {
    tracker.fail(error);
    await db.ingestJobs.update(jobId, { status: 'failed', finishedAt: clock.now(), error });
  };

  // 1. parse
  tracker.setPhase('parsing');
  let parsed: ParsedReplay;
  let t = clock.ms();
  try {
    parsed = await openReplay(bytes, {
      dropGameEvents: options.dropGameEvents ?? NOISY_GAME_EVENTS,
      onProgress: (p) => tracker.sectionProgress(p.section, p.current, p.total),
      ...(options.source ? { source: options.source } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(`parse failed: ${message}`);
    throw err;
  }
  tracker.timing('parse', clock.ms() - t);
  const sectionStatuses = Object.fromEntries(
    Object.entries(parsed.diagnostics.sections).map(([k, v]) => [k, v.status]),
  ) as Parameters<StatusTracker['sectionsDone']>[0];
  tracker.sectionsDone(sectionStatuses);

  // 2. normalize
  tracker.setPhase('normalizing');
  t = clock.ms();
  const normalized: NormalizedReplay = normalizeReplay(parsed, { now: clock.now() });
  tracker.timing('normalize', clock.ms() - t);
  tracker.setReplayId(normalized.replay.id);
  await db.ingestJobs.update(jobId, { replayId: normalized.replay.id });

  // 3. commit 1
  tracker.setPhase('writing');
  t = clock.ms();
  try {
    await writeReplay(db, normalized, {
      status: 'analysing',
      ...(options.keepFile
        ? {
            file: {
              name: options.fileName,
              bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
            },
          }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(`write failed: ${message}`);
    throw err;
  }
  tracker.timing('write', clock.ms() - t);

  // 4. ready analysers → commit 2
  tracker.queue(
    registry.list('ready').map((r) => r.analyser.id),
    'ready',
  );
  tracker.queue(
    registry.list('background').map((r) => r.analyser.id),
    'background',
  );
  tracker.setPhase('analysing-ready');
  const ctx = createMemoryContext(
    normalized,
    options.services ? { services: options.services } : {},
  );
  t = clock.ms();
  const readyRun = await runAnalysers({
    registry,
    ctx,
    modes: ['ready'],
    clock,
    onStatus: (s) => tracker.analyser(s),
  });
  await db.transaction('rw', db.derived, db.replays, async () => {
    for (const row of readyRun.computed) await saveDerived(db, row);
    await setReplayStatus(db, normalized.replay.id, 'ready');
  });
  tracker.timing('ready', clock.ms() - t);
  await db.ingestJobs.update(jobId, { status: 'ready' });
  const replayReady: ReplayRecord = {
    ...normalized.replay,
    hasFile: options.keepFile === true,
    status: 'ready',
  };
  resolveReady({
    jobId,
    replayId: normalized.replay.id,
    replay: replayReady,
    status: tracker.snapshot(),
  });

  // 5. background analysers, committed one by one
  tracker.setPhase('analysing-background');
  t = clock.ms();
  await runAnalysers({
    registry,
    ctx,
    modes: ['background'],
    existing: readyRun.computed,
    clock,
    onStatus: (s) => tracker.analyser(s),
    onComputed: (row) => saveDerived(db, row, registry.get(row.analyserId)?.analyser.cache),
  });
  tracker.timing('background', clock.ms() - t);
  await setReplayStatus(db, normalized.replay.id, 'complete');
  await db.ingestJobs.update(jobId, { status: 'complete', finishedAt: clock.now() });
  tracker.setPhase('complete');
  return {
    jobId,
    replayId: normalized.replay.id,
    replay: { ...replayReady, status: 'complete' },
    status: tracker.snapshot(),
  };
}
