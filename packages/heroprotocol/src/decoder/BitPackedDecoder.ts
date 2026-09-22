import { CorruptedError } from '../errors.js';
import type { ProtocolDefinition } from '../protocol/definition.js';
import { Decoder } from './Decoder.js';

/**
 * The schema-driven decoder for `replay.initData`, `replay.game.events` and
 * `replay.message.events`. Nothing in the stream says what type comes next; the
 * protocol alone drives every read, which is why these sections break when
 * decoded with a protocol from a different build.
 */
export class BitPackedDecoder extends Decoder {
  public constructor(data: Uint8Array, protocol: ProtocolDefinition) {
    super(data, protocol, 'big');
  }

  protected int(bounds: readonly [number, number]): number {
    return bounds[0] + this.buffer.readBits(bounds[1]);
  }

  protected blob(bounds: readonly [number, number]): Uint8Array {
    return this.buffer.readAlignedBytes(this.int(bounds));
  }

  protected bool(): boolean {
    return this.int([0, 1]) !== 0;
  }

  protected array(bounds: readonly [number, number], typeid: number): unknown[] {
    const length = this.int(bounds);
    const out = new Array<unknown>(length);
    for (let i = 0; i < length; i++) out[i] = this.instance(typeid);
    return out;
  }

  protected optional(typeid: number): unknown {
    return this.bool() ? this.instance(typeid) : null;
  }

  protected fourcc(): Uint8Array {
    return this.buffer.readFourcc();
  }

  protected bitarray(bounds: readonly [number, number]): readonly [number, number] {
    const length = this.int(bounds);
    return [length, this.buffer.readBits(length)];
  }

  protected choice(
    bounds: readonly [number, number],
    choices: Readonly<Record<number, readonly [string, number]>>,
  ): Record<string, unknown> {
    const tag = this.int(bounds);
    const field = choices[tag];
    if (field === undefined) throw new CorruptedError(`choice tag ${tag} at ${this.describe()}`);
    return { [field[0]]: this.instance(field[1]) };
  }

  protected struct(fields: readonly (readonly [string, number, number])[]): unknown {
    let result: Record<string, unknown> = {};
    for (const [name, typeid] of fields) {
      result = this.mergeParent(result, name, this.instance(typeid), fields.length);
    }
    return result;
  }

  protected real32(): number {
    return this.float(this.buffer.readUnalignedBytes(4), 'f32');
  }

  protected real64(): number {
    return this.float(this.buffer.readUnalignedBytes(8), 'f64');
  }
}
