import { CorruptedError } from '../errors.js';
import type { ProtocolDefinition, TypeInfo } from '../protocol/definition.js';
import { BitPackedBuffer } from './BitPackedBuffer.js';

/**
 * Shared shape of the two decoders. `instance(typeid)` looks the type up in the
 * protocol and dispatches on its kind with a `switch` — the 2018 port dispatched
 * by method *name* (`this[typeinfo[0]].apply(...)`), which meant the decoder's
 * method names could never be minified. Here nothing depends on names.
 */
export abstract class Decoder {
  protected readonly buffer: BitPackedBuffer;
  protected readonly typeinfos: readonly TypeInfo[];

  protected constructor(data: Uint8Array, protocol: ProtocolDefinition, endian: 'big' | 'little' = 'big') {
    this.buffer = new BitPackedBuffer(data, endian);
    this.typeinfos = protocol.typeinfos;
  }

  public describe(): string {
    return this.buffer.describe();
  }

  public get isDone(): boolean {
    return this.buffer.isDone;
  }

  public get usedBits(): number {
    return this.buffer.usedBits;
  }

  public get size(): number {
    return this.buffer.size;
  }

  public byteAlign(): void {
    this.buffer.byteAlign();
  }

  public instance(typeid: number): unknown {
    const info = this.typeinfos[typeid];
    if (info === undefined) {
      throw new CorruptedError(`typeid ${typeid} is outside the protocol's ${this.typeinfos.length} types at ${this.describe()}`);
    }
    switch (info.k) {
      case 'int':
        return this.int(info.bounds);
      case 'blob':
        return this.blob(info.bounds);
      case 'bool':
        return this.bool();
      case 'array':
        return this.array(info.bounds, info.typeid);
      case 'optional':
        return this.optional(info.typeid);
      case 'fourcc':
        return this.fourcc();
      case 'bitarray':
        return this.bitarray(info.bounds);
      case 'null':
        return null;
      case 'choice':
        return this.choice(info.bounds, info.choices);
      case 'struct':
        return this.struct(info.fields);
      case 'real32':
        return this.real32();
      case 'real64':
        return this.real64();
    }
  }

  protected abstract int(bounds: readonly [number, number]): number;
  protected abstract blob(bounds: readonly [number, number]): Uint8Array;
  protected abstract bool(): boolean;
  protected abstract array(bounds: readonly [number, number], typeid: number): unknown[];
  protected abstract optional(typeid: number): unknown;
  protected abstract fourcc(): Uint8Array;
  protected abstract bitarray(bounds: readonly [number, number]): readonly [number, unknown];
  protected abstract choice(bounds: readonly [number, number], choices: Readonly<Record<number, readonly [string, number]>>): Record<string, unknown>;
  protected abstract struct(fields: readonly (readonly [string, number, number])[]): unknown;
  protected abstract real32(): number;
  protected abstract real64(): number;

  /**
   * Blizzard's `__parent` pseudo-field: the parent struct's fields are flattened
   * into this one. Shared by both decoders.
   */
  protected mergeParent(result: Record<string, unknown>, name: string, value: unknown, fieldCount: number): Record<string, unknown> {
    if (name === '__parent') {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.assign(result, value as Record<string, unknown>);
      }
      if (fieldCount === 0) return value as Record<string, unknown>;
    }
    result[name] = value;
    return result;
  }

  protected float(bytes: Uint8Array, kind: 'f32' | 'f64'): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return kind === 'f32' ? view.getFloat32(0, false) : view.getFloat64(0, false);
  }
}
