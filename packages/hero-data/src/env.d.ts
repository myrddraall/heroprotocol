// Platform globals used through structural types, declared ambiently so consumers
// do not inherit lib.dom by importing this package.
declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number): void;
declare class AbortController {
  readonly signal: unknown;
  abort(): void;
}
