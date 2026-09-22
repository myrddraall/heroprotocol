import { CorruptedError } from '../errors.js';
import type { ProtocolDefinition } from '../protocol/definition.js';
import { Decoder } from './Decoder.js';

/**
 * The self-describing decoder for the header, `replay.details` and
 * `replay.tracker.events`. Every value is preceded by a one-byte type tag and
 * every struct field by a field id, so unknown fields can be skipped — which is
 * why these sections decode correctly even with a protocol from another build.
 */
export class VersionedDecoder extends Decoder {
  public constructor(data: Uint8Array, protocol: ProtocolDefinition) {
    super(data, protocol, 'big');
  }

  private expectSkip(expected: number): void {
    const got = this.buffer.readBits(8);
    if (got !== expected) {
      throw new CorruptedError(`expected type tag ${expected}, found ${got} at ${this.describe()}`);
    }
  }

  /**
   * Variable-length signed integer: bit 0 of the first byte is the sign, then
   * 6 payload bits, then 7 per continuation byte. Values are exact to 2^53.
   *
   * The 2018 port routed this through the `long` package (an undeclared
   * dependency it inherited by accident); plain arithmetic suffices.
   */
  private vint(): number {
    let b = this.buffer.readBits(8);
    const negative = (b & 1) !== 0;
    let result = (b >>> 1) & 0x3f;
    let bits = 6;
    while ((b & 0x80) !== 0) {
      b = this.buffer.readBits(8);
      result += (b & 0x7f) * 2 ** bits;
      bits += 7;
    }
    return negative ? -result : result;
  }

  protected int(): number {
    this.expectSkip(9);
    return this.vint();
  }

  protected blob(): Uint8Array {
    this.expectSkip(2);
    return this.buffer.readAlignedBytes(this.vint());
  }

  protected bool(): boolean {
    this.expectSkip(6);
    return this.buffer.readBits(8) !== 0;
  }

  protected array(_bounds: readonly [number, number], typeid: number): unknown[] {
    this.expectSkip(0);
    const length = this.vint();
    const out = new Array<unknown>(length);
    for (let i = 0; i < length; i++) out[i] = this.instance(typeid);
    return out;
  }

  protected optional(typeid: number): unknown {
    this.expectSkip(4);
    return this.buffer.readBits(8) !== 0 ? this.instance(typeid) : null;
  }

  protected fourcc(): Uint8Array {
    this.expectSkip(7);
    return this.buffer.readAlignedBytes(4);
  }

  protected bitarray(): readonly [number, Uint8Array] {
    this.expectSkip(1);
    const length = this.vint();
    // (length + 7) >> 3 — the 2018 port divided without flooring.
    return [length, this.buffer.readAlignedBytes((length + 7) >> 3)];
  }

  protected choice(_bounds: readonly [number, number], choices: Readonly<Record<number, readonly [string, number]>>): Record<string, unknown> {
    this.expectSkip(3);
    const tag = this.vint();
    const field = choices[tag];
    if (field === undefined) {
      this.skipInstance();
      return {};
    }
    return { [field[0]]: this.instance(field[1]) };
  }

  protected struct(fields: readonly (readonly [string, number, number])[]): unknown {
    this.expectSkip(5);
    let result: Record<string, unknown> = {};
    const length = this.vint();
    for (let i = 0; i < length; i++) {
      const tag = this.vint();
      const field = fields.find((f) => f[2] === tag);
      if (field === undefined) {
        this.skipInstance(); // a field this protocol does not know: forward compatibility
        continue;
      }
      result = this.mergeParent(result, field[0], this.instance(field[1]), fields.length);
    }
    return result;
  }

  protected real32(): number {
    this.expectSkip(7);
    return this.float(this.buffer.readAlignedBytes(4), 'f32');
  }

  protected real64(): number {
    this.expectSkip(8);
    return this.float(this.buffer.readAlignedBytes(8), 'f64');
  }

  /** Consume one tagged value of any type without interpreting it. */
  private skipInstance(): void {
    const tag = this.buffer.readBits(8);
    switch (tag) {
      case 0: {
        const length = this.vint();
        for (let i = 0; i < length; i++) this.skipInstance();
        return;
      }
      case 1:
        this.buffer.readAlignedBytes((this.vint() + 7) >> 3);
        return;
      case 2:
        this.buffer.readAlignedBytes(this.vint());
        return;
      case 3:
        this.vint();
        this.skipInstance();
        return;
      case 4:
        if (this.buffer.readBits(8) !== 0) this.skipInstance();
        return;
      case 5: {
        const length = this.vint();
        for (let i = 0; i < length; i++) {
          this.vint();
          this.skipInstance();
        }
        return;
      }
      case 6:
        this.buffer.readAlignedBytes(1);
        return;
      case 7:
        this.buffer.readAlignedBytes(4);
        return;
      case 8:
        this.buffer.readAlignedBytes(8);
        return;
      case 9:
        this.vint();
        return;
      default:
        throw new CorruptedError(`unknown type tag ${tag} while skipping at ${this.describe()}`);
    }
  }
}
