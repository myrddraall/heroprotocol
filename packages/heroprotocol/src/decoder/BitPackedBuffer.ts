import { TruncatedError } from '../errors.js';

/**
 * A bit-level cursor over a byte array, port of Blizzard's `BitPackedBuffer`.
 *
 * Reads are unsigned and exact up to 53 bits: partial bytes are combined with
 * multiplication rather than `<<`, so a 32-bit field with its top bit set comes
 * back as the positive value the Python reference produces, not as a negative
 * int32. (The 2018 port used `|=` and `<<`, which silently went negative on
 * exactly those fields.)
 *
 * Byte order: 'big' is the order used by every section except the attributes
 * file, which is little-endian.
 */
export class BitPackedBuffer {
  private used = 0;
  private next = 0;
  private nextBits = 0;
  private readonly bigEndian: boolean;

  public constructor(
    private readonly data: Uint8Array,
    endian: 'big' | 'little' = 'big',
  ) {
    this.bigEndian = endian === 'big';
  }

  /** Where the cursor is, for error messages: `buffer(nn/bits,[byte]=xx)`. */
  public describe(): string {
    const pending = this.nextBits > 0 ? this.next.toString(16) : '0';
    const atByte = this.used < this.data.length ? this.data[this.used]!.toString(16) : '--';
    return `buffer(${pending}/${this.nextBits},[${this.used}]=${atByte})`;
  }

  public get isDone(): boolean {
    return this.nextBits === 0 && this.used >= this.data.length;
  }

  /** Total size in bits. */
  public get size(): number {
    return this.data.length * 8;
  }

  public get usedBits(): number {
    return this.used * 8 - this.nextBits;
  }

  public byteAlign(): void {
    this.nextBits = 0;
  }

  /** A view (not a copy) of the next `count` whole bytes, after aligning. */
  public readAlignedBytes(count: number): Uint8Array {
    this.byteAlign();
    if (!Number.isInteger(count) || count < 0 || this.used + count > this.data.length) {
      throw new TruncatedError(this.describe());
    }
    const out = this.data.subarray(this.used, this.used + count);
    this.used += count;
    return out;
  }

  /** Read `bits` bits (0..53) as an unsigned number. */
  public readBits(bits: number): number {
    let result = 0;
    let resultBits = 0;

    while (resultBits !== bits) {
      if (this.nextBits === 0) {
        if (this.isDone) throw new TruncatedError(this.describe());
        this.next = this.data[this.used]!;
        this.used += 1;
        this.nextBits = 8;
      }

      const copyBits = Math.min(bits - resultBits, this.nextBits);
      const copy = this.next & ((1 << copyBits) - 1);

      // Multiplication keeps the value unsigned and exact past 31 bits.
      if (this.bigEndian) {
        result += copy * 2 ** (bits - resultBits - copyBits);
      } else {
        result += copy * 2 ** resultBits;
      }

      this.next >>>= copyBits;
      this.nextBits -= copyBits;
      resultBits += copyBits;
    }

    return result;
  }

  /** `count` bytes read eight bits at a time from the current, possibly unaligned, position. */
  public readUnalignedBytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = this.readBits(8);
    return out;
  }

  /**
   * A fourcc: ONE 32-bit read, laid out big-endian.
   *
   * This is not the same as `readUnalignedBytes(4)`. `readBits` consumes a
   * partially-used byte low-bits-first and then whole bytes as units, so a
   * single 32-bit read at an unaligned position yields different bytes from
   * four 8-bit reads. Blizzard's decoder does the single read
   * (`struct.pack('!I', read_bits(32))`) for fourcc — and, deliberately, the
   * four 8-bit reads for reals — so both are kept, each used where upstream
   * uses it. The 2018 port used four 8-bit reads for fourcc and so decoded every
   * unaligned one (hero handles in mastery tiers, the disabled-hero list) as garbage.
   */
  public readFourcc(): Uint8Array {
    const v = this.readBits(32);
    return Uint8Array.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
}
