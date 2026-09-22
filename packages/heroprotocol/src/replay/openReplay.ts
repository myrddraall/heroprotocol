import { MPQArchive } from '@myrddraall/mpq';
import { InvalidReplayError, ProtocolNotFoundError } from '../errors.js';
import { BUILD_INDEX } from '../protocol/data/index.js';
import type { BuildIndex } from '../protocol/definition.js';
import { ProtocolRegistry } from '../protocol/registry.js';
import { Protocol, type RawAttributes, type RawEvent } from '../protocol/runtime.js';
import { defaultSource, type ProtocolSource } from '../protocol/source.js';
import type { ReplayDetails, ReplayHeader, ReplayInitData } from '../types/index.js';
import {
  ALL_SECTIONS,
  SECTION_FILES,
  type DecodeAttempt,
  type Diagnostics,
  type Provenance,
  type SectionDiagnostic,
  type SectionName,
} from './diagnostics.js';
import { hasReplacementChar, stringifyBlobs } from './strings.js';

/** The protocol Blizzard's own tool reads every header with; any protocol can, the header format is versioned. */
export const BOOTSTRAP_BUILD = 29406;

export interface ReplayProgress {
  readonly section: SectionName;
  readonly current: number;
  readonly total: number;
}

export interface OpenReplayOptions {
  /** Where protocols come from. Default: the bundled definitions only. */
  readonly source?: ProtocolSource;
  /** Which sections to decode. Default: all. The header is always decoded. */
  readonly sections?: readonly SectionName[];
  /** Game event names to decode but not keep. See `NOISY_GAME_EVENTS`. */
  readonly dropGameEvents?: ReadonlySet<string>;
  /** Decode byte blobs as UTF-8 text (default true). */
  readonly strings?: boolean;
  readonly onProgress?: (progress: ReplayProgress) => void;
}

export interface ParsedReplay {
  readonly header: ReplayHeader;
  readonly details?: ReplayDetails;
  readonly initData?: ReplayInitData;
  readonly attributes?: RawAttributes;
  readonly trackerEvents?: readonly RawEvent[];
  readonly messageEvents?: readonly RawEvent[];
  readonly gameEvents?: readonly RawEvent[];
  /** `header.m_version.m_baseBuild` */
  readonly build: number;
  /** The protocol most sections were decoded with. */
  readonly protocol: number;
  readonly fileSize: number;
  readonly diagnostics: Diagnostics;
}

/**
 * Parse a `.StormReplay`, doing what it can.
 *
 * The header is required — it names the build, so nothing can be decoded
 * without it. Every other section is decoded independently: a failure in one
 * leaves the others intact, an event stream that breaks part-way keeps what it
 * decoded, and when the exact protocol for the build is unavailable the
 * nearest ones are tried, each result checked for signs of a wrong schema
 * before it is accepted. `diagnostics` says exactly what happened per section.
 */
export async function openReplay(
  data: ArrayBuffer | ArrayBufferView,
  options: OpenReplayOptions = {},
): Promise<ParsedReplay> {
  const source = options.source ?? defaultSource;
  const wanted = new Set<SectionName>(options.sections ?? ALL_SECTIONS);
  const strings = options.strings ?? true;
  const progress = options.onProgress;

  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  let mpq: MPQArchive;
  try {
    mpq = new MPQArchive(bytes);
  } catch (e) {
    throw new InvalidReplayError(`not a replay: ${e instanceof Error ? e.message : String(e)}`);
  }
  const userData = mpq.header.userDataHeader?.content;
  if (userData === undefined || userData.byteLength === 0) {
    throw new InvalidReplayError(
      'the archive has no user-data header, so it carries no replay header',
    );
  }

  // --- header: bootstrap protocol, then the build it names ---
  const bootstrap = await loadProtocol(source, BOOTSTRAP_BUILD);
  if (bootstrap === undefined)
    throw new ProtocolNotFoundError(
      BOOTSTRAP_BUILD,
      'the bootstrap protocol is missing from the source',
    );
  let header: ReplayHeader;
  try {
    header = finish(bootstrap.decodeHeader(userData), strings) as ReplayHeader;
  } catch (e) {
    throw new InvalidReplayError(
      `the replay header did not decode: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const build = header.m_version?.m_baseBuild;
  if (!Number.isInteger(build) || build < 1) {
    throw new InvalidReplayError('the replay header carries no usable base build');
  }

  // --- which protocols to try ---
  // The source decides which builds exist; the bundled index is only what the
  // bundled source reports. A fetching source's index also names builds newer
  // than the bundle, which is how those become "exact" rather than "nearest".
  let known: BuildIndex;
  try {
    known = await source.index();
  } catch {
    known = BUILD_INDEX; // an unreachable index falls back to what is compiled in
  }
  const registry = new ProtocolRegistry(known);
  const exact = registry.exact(build);
  const candidates = registry.candidates(build).map((rep): [number, Provenance] => {
    if (rep === exact) return [rep, BUILD_INDEX[String(build)] === undefined ? 'fetched' : 'exact'];
    return [rep, 'nearest'];
  });
  if (candidates.length === 0) {
    throw new ProtocolNotFoundError(build, 'no protocol for this build or any neighbour');
  }

  const sections: Record<SectionName, SectionDiagnostic> = {
    header: { status: 'ok', protocol: BOOTSTRAP_BUILD, provenance: 'nearest', attempts: [] },
    details: { status: 'skipped', attempts: [] },
    initData: { status: 'skipped', attempts: [] },
    attributes: { status: 'skipped', attempts: [] },
    trackerEvents: { status: 'skipped', attempts: [] },
    messageEvents: { status: 'skipped', attempts: [] },
    gameEvents: { status: 'skipped', attempts: [] },
  };
  const result: {
    -readonly [K in keyof ParsedReplay]?: ParsedReplay[K];
  } = { header, build, fileSize: bytes.byteLength };

  const file = (section: Exclude<SectionName, 'header'>): Uint8Array | null =>
    mpq.readFile(SECTION_FILES[section]);

  // --- header again, with the build's own protocol ---
  // The bootstrap decode is only for learning the build: the versioned format
  // skips fields the old schema does not know, so fields added since 2015
  // (m_ngdpRootKey, m_replayCompatibilityHash) would otherwise be missing.
  {
    const outcome = await decodeWithCandidates(source, candidates, (protocol) =>
      finish(protocol.decodeHeader(userData), strings),
    );
    if (outcome.value !== undefined) {
      header = outcome.value as ReplayHeader;
      result.header = header;
      sections.header = outcome.diagnostic;
    }
  }

  const skip = (section: SectionName): void => {
    sections[section] = { status: 'skipped', attempts: [] };
  };

  // --- single-instance sections ---
  for (const section of ['details', 'initData'] as const) {
    if (!wanted.has(section)) {
      skip(section);
      continue;
    }
    const bytesFor = file(section);
    if (bytesFor === null) {
      sections[section] = {
        status: 'failed',
        attempts: [],
        error: `${SECTION_FILES[section]} is not in the archive`,
      };
      continue;
    }
    progress?.({ section, current: 0, total: 1 });
    const outcome = await decodeWithCandidates(source, candidates, (protocol) => {
      const value =
        section === 'details'
          ? protocol.decodeDetails(bytesFor)
          : protocol.decodeInitData(bytesFor);
      const finished = finish(value, strings);
      if (section === 'details') checkDetails(finished as ReplayDetails);
      return finished;
    });
    sections[section] = outcome.diagnostic;
    if (outcome.value !== undefined) {
      (result as Record<string, unknown>)[section] = outcome.value;
    }
    progress?.({ section, current: 1, total: 1 });
  }

  // --- attributes: no protocol involved ---
  if (wanted.has('attributes')) {
    const a = file('attributes');
    if (a === null) {
      sections.attributes = {
        status: 'failed',
        attempts: [],
        error: `${SECTION_FILES.attributes} is not in the archive`,
      };
    } else {
      try {
        result.attributes = new Protocol(bootstrap.def).decodeAttributes(a);
        sections.attributes = { status: 'ok', attempts: [] };
      } catch (e) {
        sections.attributes = { status: 'failed', attempts: [], error: message(e) };
      }
    }
  } else {
    skip('attributes');
  }

  // --- event streams ---
  for (const section of ['trackerEvents', 'messageEvents', 'gameEvents'] as const) {
    if (!wanted.has(section)) {
      skip(section);
      continue;
    }
    const bytesFor = file(section);
    if (bytesFor === null) {
      sections[section] = {
        status: 'failed',
        attempts: [],
        error: `${SECTION_FILES[section]} is not in the archive`,
      };
      continue;
    }
    const drop = section === 'gameEvents' ? options.dropGameEvents : undefined;
    const outcome = await decodeEventsWithCandidates(
      source,
      candidates,
      section,
      bytesFor,
      drop,
      strings,
      progress,
    );
    sections[section] = outcome.diagnostic;
    if (outcome.events !== undefined) (result as Record<string, unknown>)[section] = outcome.events;
  }

  // --- summarise ---
  const used = new Map<number, number>();
  for (const d of Object.values(sections))
    if (d.protocol !== undefined && d.status !== 'skipped')
      used.set(d.protocol, (used.get(d.protocol) ?? 0) + 1);
  used.delete(BOOTSTRAP_BUILD);
  const [protocol, provenance] =
    [...used.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => [p, candidates.find((c) => c[0] === p)?.[1] ?? 'nearest'] as const)[0] ??
    ([candidates[0]![0], candidates[0]![1]] as const);

  const complete = [...wanted].every((s) => sections[s].status === 'ok');
  result.protocol = protocol;
  result.diagnostics = { build, protocol, provenance, sections, complete };
  return result as ParsedReplay;
}

// ---------------------------------------------------------------- internals

const protocolCache = new WeakMap<ProtocolSource, Map<number, Promise<Protocol | undefined>>>();

async function loadProtocol(source: ProtocolSource, build: number): Promise<Protocol | undefined> {
  let perSource = protocolCache.get(source);
  if (perSource === undefined) {
    perSource = new Map();
    protocolCache.set(source, perSource);
  }
  let p = perSource.get(build);
  if (p === undefined) {
    p = source.load(build).then((def) => (def === undefined ? undefined : new Protocol(def)));
    perSource.set(build, p);
  }
  return p;
}

function message(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function finish(value: unknown, strings: boolean): unknown {
  return strings ? stringifyBlobs(value) : value;
}

/** A wrong schema that happens not to throw still shows in the strings it produces. */
function checkDetails(details: ReplayDetails): void {
  if (typeof details.m_title !== 'string' || hasReplacementChar(details.m_title)) {
    throw new Error('map title is not valid text');
  }
  for (const p of details.m_playerList ?? []) {
    if (typeof p.m_name !== 'string' || hasReplacementChar(p.m_name))
      throw new Error('a player name is not valid text');
  }
}

async function decodeWithCandidates(
  source: ProtocolSource,
  candidates: readonly (readonly [number, Provenance])[],
  decode: (protocol: Protocol) => unknown,
): Promise<{ value?: unknown; diagnostic: SectionDiagnostic }> {
  const attempts: DecodeAttempt[] = [];
  for (const [build, provenance] of candidates) {
    const protocol = await loadProtocol(source, build);
    if (protocol === undefined) {
      attempts.push({ protocol: build, provenance, error: 'protocol not available' });
      continue;
    }
    try {
      const value = decode(protocol);
      attempts.push({ protocol: build, provenance });
      return { value, diagnostic: { status: 'ok', protocol: build, provenance, attempts } };
    } catch (e) {
      attempts.push({ protocol: build, provenance, error: message(e) });
    }
  }
  return {
    diagnostic: {
      status: 'failed',
      attempts,
      error: attempts.at(-1)?.error ?? 'no candidate protocol',
    },
  };
}

async function decodeEventsWithCandidates(
  source: ProtocolSource,
  candidates: readonly (readonly [number, Provenance])[],
  section: 'trackerEvents' | 'messageEvents' | 'gameEvents',
  bytes: Uint8Array,
  drop: ReadonlySet<string> | undefined,
  strings: boolean,
  progress: ((p: ReplayProgress) => void) | undefined,
): Promise<{ events?: RawEvent[]; diagnostic: SectionDiagnostic }> {
  const attempts: DecodeAttempt[] = [];
  let best:
    | {
        events: RawEvent[];
        build: number;
        provenance: Provenance;
        failedAt: NonNullable<SectionDiagnostic['failedAt']>;
        error: string;
      }
    | undefined;
  const total = bytes.byteLength * 8;

  for (const [build, provenance] of candidates) {
    const protocol = await loadProtocol(source, build);
    if (protocol === undefined) {
      attempts.push({ protocol: build, provenance, error: 'protocol not available' });
      continue;
    }
    const events: RawEvent[] = [];
    let lastGameloop = 0;
    let usedBits = 0;
    const opts = {
      ...(drop ? { drop } : {}),
      onProgress: (used: number, all: number): void => {
        usedBits = used;
        progress?.({ section, current: used, total: all });
      },
    };
    const stream =
      section === 'trackerEvents'
        ? protocol.trackerEvents(bytes, opts)
        : section === 'messageEvents'
          ? protocol.messageEvents(bytes, opts)
          : protocol.gameEvents(bytes, opts);
    try {
      for (const raw of stream) {
        // No value check on _userid: the field is 5 bits wide and the game uses
        // 16 for the system user, so any decodable value is legitimate. Wrong
        // schemas show up as unknown event ids or truncation instead.
        lastGameloop = raw._gameloop;
        events.push(strings ? stringifyBlobs(raw) : raw);
      }
      attempts.push({ protocol: build, provenance, eventsDecoded: events.length });
      progress?.({ section, current: total, total });
      return {
        events,
        diagnostic: {
          status: 'ok',
          protocol: build,
          provenance,
          attempts,
          eventsDecoded: events.length,
        },
      };
    } catch (e) {
      const error = message(e);
      attempts.push({ protocol: build, provenance, error, eventsDecoded: events.length });
      if (events.length > 0 && (best === undefined || events.length > best.events.length)) {
        best = {
          events,
          build,
          provenance,
          error,
          failedAt: { usedBits, totalBits: total, lastGameloop },
        };
      }
    }
  }

  if (best !== undefined) {
    // Nothing decoded to the end; keep the longest run — the honest maximum.
    return {
      events: best.events,
      diagnostic: {
        status: 'partial',
        protocol: best.build,
        provenance: best.provenance,
        attempts,
        eventsDecoded: best.events.length,
        failedAt: best.failedAt,
        error: best.error,
      },
    };
  }
  return {
    diagnostic: {
      status: 'failed',
      attempts,
      error: attempts.at(-1)?.error ?? 'no candidate protocol',
    },
  };
}
