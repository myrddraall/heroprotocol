/**
 * A protocol is data: the table of type layouts and the event-id tables that
 * Blizzard publishes per game build as `protocolNNNNN.py`. Every one of the 390
 * published files is one of only 36 distinct definitions.
 *
 * This is the JSON shape the fixed decoder runtime interprets. Nothing in it is
 * ever executed — the 2018 version transpiled the Python to JavaScript and ran
 * it through `Function()`, which is what made it need `unsafe-eval`.
 */
export type TypeInfo =
  | { readonly k: 'int'; readonly bounds: IntBounds }
  | { readonly k: 'blob'; readonly bounds: IntBounds }
  | { readonly k: 'bool' }
  | { readonly k: 'array'; readonly bounds: IntBounds; readonly typeid: number }
  | { readonly k: 'optional'; readonly typeid: number }
  | { readonly k: 'fourcc' }
  | { readonly k: 'bitarray'; readonly bounds: IntBounds }
  | { readonly k: 'null' }
  | {
      readonly k: 'choice';
      readonly bounds: IntBounds;
      readonly choices: Readonly<Record<number, ChoiceField>>;
    }
  | { readonly k: 'struct'; readonly fields: readonly StructField[] }
  | { readonly k: 'real32' }
  | { readonly k: 'real64' };

/** `[minimum, bitCount]` — the value stored is `minimum + readBits(bitCount)`. */
export type IntBounds = readonly [min: number, bits: number];
/** `[fieldName, typeid]` */
export type ChoiceField = readonly [name: string, typeid: number];
/** `[fieldName, typeid, tag]` — `tag` is the versioned format's field id; `-1` means none. */
export type StructField = readonly [name: string, typeid: number, tag: number];

/** `eventid -> [typeid, eventName]` */
export type EventTable = Readonly<Record<number, readonly [typeid: number, name: string]>>;

export interface ProtocolDefinition {
  /** The lowest build that uses this exact definition; its identity. */
  readonly build: number;
  readonly typeinfos: readonly TypeInfo[];
  readonly gameEventTypes: EventTable;
  readonly messageEventTypes: EventTable;
  readonly trackerEventTypes: EventTable;
  readonly gameEventIdTypeid: number;
  readonly messageEventIdTypeid: number;
  readonly trackerEventIdTypeid: number;
  /** NNet.SVarUint32, used for gameloop deltas. 7 in every published protocol. */
  readonly svaruint32Typeid: number;
  /** NNet.Replay.SGameUserId. 8 in every published protocol. */
  readonly replayUserIdTypeid: number;
  readonly headerTypeid: number;
  readonly detailsTypeid: number;
  readonly initDataTypeid: number;
}

/** `build -> representative build` for every published build. */
export type BuildIndex = Readonly<Record<string, number>>;
