import { BitPackedBuffer } from '../decoder/BitPackedBuffer.js';
import { BitPackedDecoder } from '../decoder/BitPackedDecoder.js';
import { VersionedDecoder } from '../decoder/VersionedDecoder.js';
import { CorruptedError } from '../errors.js';
import type { EventTable, ProtocolDefinition } from './definition.js';

/** Fields the event stream decoder adds to every event. */
export interface EventEnvelope {
  readonly _event: string;
  readonly _eventid: number;
  readonly _gameloop: number;
  readonly _userid?: { readonly m_userId: number };
  readonly _bits: number;
}

export type RawEvent = EventEnvelope & Record<string, unknown>;

export interface EventStreamOptions {
  /** Event names to decode but not yield — decoding cannot be skipped, materialising can. */
  readonly drop?: ReadonlySet<string>;
  /** Called every `progressEvery` events with bits consumed / total bits. */
  readonly onProgress?: (usedBits: number, totalBits: number) => void;
  readonly progressEvery?: number;
}

/** The decoded attributes file. */
export interface RawAttributes {
  readonly source: number;
  readonly mapNamespace: number;
  readonly scopes: Readonly<Record<number, Readonly<Record<number, readonly RawAttributeValue[]>>>>;
}
export interface RawAttributeValue {
  readonly namespace: number;
  readonly attrid: number;
  /** The 4-byte value with padding zeros stripped, as text — e.g. 'Priv', 'Hmmr'. */
  readonly value: string;
}

/**
 * The fixed interpreter over a ProtocolDefinition. Everything that the 2018
 * version generated as a JavaScript string per protocol and executed with
 * `Function()` is here, once, as ordinary code; the per-protocol part is data.
 */
export class Protocol {
  public constructor(public readonly def: ProtocolDefinition) {}

  public get build(): number {
    return this.def.build;
  }

  public decodeHeader(bytes: Uint8Array): unknown {
    return new VersionedDecoder(bytes, this.def).instance(this.def.headerTypeid);
  }

  public decodeDetails(bytes: Uint8Array): unknown {
    return new VersionedDecoder(bytes, this.def).instance(this.def.detailsTypeid);
  }

  public decodeInitData(bytes: Uint8Array): unknown {
    return new BitPackedDecoder(bytes, this.def).instance(this.def.initDataTypeid);
  }

  public *gameEvents(bytes: Uint8Array, options?: EventStreamOptions): Generator<RawEvent> {
    yield* this.eventStream(
      new BitPackedDecoder(bytes, this.def),
      this.def.gameEventIdTypeid,
      this.def.gameEventTypes,
      true,
      options,
    );
  }

  public *messageEvents(bytes: Uint8Array, options?: EventStreamOptions): Generator<RawEvent> {
    yield* this.eventStream(
      new BitPackedDecoder(bytes, this.def),
      this.def.messageEventIdTypeid,
      this.def.messageEventTypes,
      true,
      options,
    );
  }

  public *trackerEvents(bytes: Uint8Array, options?: EventStreamOptions): Generator<RawEvent> {
    yield* this.eventStream(
      new VersionedDecoder(bytes, this.def),
      this.def.trackerEventIdTypeid,
      this.def.trackerEventTypes,
      false,
      options,
    );
  }

  /**
   * The attributes file is the one section with its own layout: little-endian,
   * fixed-width, no protocol types involved.
   */
  public decodeAttributes(bytes: Uint8Array): RawAttributes {
    const buffer = new BitPackedBuffer(bytes, 'little');
    const scopes: Record<number, Record<number, RawAttributeValue[]>> = {};
    if (buffer.isDone) return { source: 0, mapNamespace: 0, scopes };

    const source = buffer.readBits(8);
    const mapNamespace = buffer.readBits(32);
    buffer.readBits(32); // count — the loop below reads to the end regardless, as Blizzard's does

    while (!buffer.isDone) {
      const namespace = buffer.readBits(32);
      const attrid = buffer.readBits(32);
      const scope = buffer.readBits(8);
      const raw = buffer.readAlignedBytes(4);
      // Stored reversed and zero-padded; strip the padding and read as ASCII.
      const rev = [raw[3]!, raw[2]!, raw[1]!, raw[0]!];
      let start = 0;
      while (start < 4 && rev[start] === 0) start++;
      let end = 4;
      while (end > start && rev[end - 1] === 0) end--;
      let value = '';
      for (let i = start; i < end; i++) value += String.fromCharCode(rev[i]!);
      ((scopes[scope] ??= {})[attrid] ??= []).push({ namespace, attrid, value });
    }
    return { source, mapNamespace, scopes };
  }

  private *eventStream(
    decoder: BitPackedDecoder | VersionedDecoder,
    eventIdTypeid: number,
    table: EventTable,
    decodeUserId: boolean,
    options: EventStreamOptions = {},
  ): Generator<RawEvent> {
    const drop = options.drop;
    const every = options.progressEvery ?? 256;
    let gameloop = 0;
    let n = 0;

    while (!decoder.isDone) {
      const startBits = decoder.usedBits;

      // gameloop delta, encoded as SVarUint32 — a choice whose single field holds the value
      const delta = decoder.instance(this.def.svaruint32Typeid) as Record<string, number>;
      gameloop += delta[Object.keys(delta)[0]!]!;

      const userid = decodeUserId
        ? (decoder.instance(this.def.replayUserIdTypeid) as { m_userId: number })
        : undefined;

      const eventid = decoder.instance(eventIdTypeid) as number;
      const type = table[eventid];
      if (type === undefined) {
        throw new CorruptedError(`unknown eventid ${eventid} at ${decoder.describe()}`);
      }
      const [typeid, name] = type;

      const body = decoder.instance(typeid) as Record<string, unknown>;
      decoder.byteAlign(); // the next event is byte-aligned

      n++;
      if (options.onProgress && n % every === 0) options.onProgress(decoder.usedBits, decoder.size);

      if (drop?.has(name)) continue;

      const event: Record<string, unknown> = body;
      event['_event'] = name;
      event['_eventid'] = eventid;
      event['_gameloop'] = gameloop;
      if (decodeUserId) event['_userid'] = userid;
      event['_bits'] = decoder.usedBits - startBits;
      yield event as RawEvent;
    }
    if (options.onProgress) options.onProgress(decoder.size, decoder.size);
  }
}

/** Unit tags combine an index and a recycle counter; these match Blizzard's helpers. */
export function unitTag(index: number, recycle: number): number {
  return index * 0x40000 + recycle;
}
export function unitTagIndex(tag: number): number {
  return Math.floor(tag / 0x40000) & 0x3fff;
}
export function unitTagRecycle(tag: number): number {
  return tag & 0x3ffff;
}
