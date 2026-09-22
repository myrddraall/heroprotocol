/** Base class for every error this library raises deliberately. */
export class HeroprotocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HeroprotocolError';
  }
}

/** The bit-stream ended before a value could be read. */
export class TruncatedError extends HeroprotocolError {
  public constructor(at: string) {
    super(`data ended unexpectedly at ${at}`);
    this.name = 'TruncatedError';
  }
}

/** A value in the stream is not what the protocol says should be there. */
export class CorruptedError extends HeroprotocolError {
  public constructor(detail: string) {
    super(`corrupt or mismatched data: ${detail}`);
    this.name = 'CorruptedError';
  }
}

/** The bytes are not a replay at all. */
export class InvalidReplayError extends HeroprotocolError {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidReplayError';
  }
}

/** No protocol could be found for a build, bundled or fetched. */
export class ProtocolNotFoundError extends HeroprotocolError {
  public readonly build: number;
  public constructor(build: number, detail: string) {
    super(`no protocol available for build ${build}: ${detail}`);
    this.name = 'ProtocolNotFoundError';
    this.build = build;
  }
}

/** Blizzard's Python protocol file could not be converted to a definition. */
export class ProtocolConversionError extends HeroprotocolError {
  public constructor(detail: string) {
    super(`could not convert protocol source: ${detail}`);
    this.name = 'ProtocolConversionError';
  }
}
