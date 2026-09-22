import type { AnalyserMode, AnalyserStatus } from '../analysers/types.js';
import type { IngestResult } from '../ingest/pipeline.js';
import type { IngestStatus } from '../ingest/status.js';
import type { DerivedRecord } from '../model/records.js';

/**
 * The message protocol between the main-thread client and the ingest worker.
 * Every request that does work carries a `ref` the client chose; every response
 * about that work echoes it. All payloads are structured-cloneable.
 */

export interface AnalyserSummary {
  readonly id: string;
  readonly mode: AnalyserMode;
  readonly version: number;
}

export type WorkerRequest =
  | { readonly type: 'init'; readonly dbName: string }
  | {
      readonly type: 'ingest';
      readonly ref: number;
      readonly bytes: ArrayBuffer;
      readonly fileName: string;
      readonly keepFile: boolean;
    }
  | {
      readonly type: 'analyse';
      readonly ref: number;
      readonly replayId: string;
      readonly analyserId: string;
      readonly params?: unknown;
      readonly force?: boolean;
    }
  | { readonly type: 'reanalyse'; readonly ref: number; readonly replayId?: string }
  | { readonly type: 'close' };

export type WorkerResponse =
  | { readonly type: 'ready'; readonly analysers: readonly AnalyserSummary[] }
  | { readonly type: 'ingest-status'; readonly ref: number; readonly status: IngestStatus }
  | { readonly type: 'ingest-ready'; readonly ref: number; readonly result: IngestResult }
  | { readonly type: 'ingest-complete'; readonly ref: number; readonly result: IngestResult }
  | {
      readonly type: 'analyser-status';
      readonly ref: number;
      readonly replayId: string;
      readonly status: AnalyserStatus;
    }
  | { readonly type: 'analysed'; readonly ref: number; readonly row: DerivedRecord }
  | { readonly type: 'reanalysed'; readonly ref: number; readonly rows: readonly DerivedRecord[] }
  | { readonly type: 'failed'; readonly ref: number; readonly message: string }
  | { readonly type: 'closed' };

/**
 * The part of a worker's global scope (or a MessagePort) the worker side uses. Two
 * `postMessage` overloads rather than an optional parameter, so the DOM's `Worker`,
 * `DedicatedWorkerGlobalScope` and `MessagePort` all satisfy it structurally.
 */
export interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  postMessage(message: WorkerResponse, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  start?(): void;
  close?(): void;
}

/** The part of a `Worker` (or a MessagePort) the client side uses. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  postMessage(message: WorkerRequest, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  start?(): void;
  terminate?(): void;
  close?(): void;
}
