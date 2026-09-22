// Ambient declarations for the few platform globals this library touches, so
// `lib` can stay `["ES2022"]` and consumers of the emitted .d.ts do not inherit
// lib.dom. Every target runtime — browsers, Node >= 18, workers — provides them.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
interface AbortSignal {
  readonly aborted: boolean;
}
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle: unknown): void;
