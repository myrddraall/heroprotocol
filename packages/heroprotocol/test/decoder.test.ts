import { describe, expect, it } from 'vitest';
import { BitPackedBuffer } from '../src/decoder/BitPackedBuffer.js';
import { VersionedDecoder } from '../src/decoder/VersionedDecoder.js';
import { TruncatedError, CorruptedError } from '../src/errors.js';
import type { ProtocolDefinition } from '../src/protocol/definition.js';

describe('BitPackedBuffer', () => {
  it('reads big-endian bits across byte boundaries', () => {
    const b = new BitPackedBuffer(Uint8Array.from([0b10110011, 0b01000000]));
    expect(b.readBits(3)).toBe(0b011); // low bits of the first byte come first
    expect(b.readBits(5)).toBe(0b10110);
    expect(b.readBits(2)).toBe(0b00);
    expect(b.usedBits).toBe(10);
    expect(b.isDone).toBe(false);
  });

  it('returns unsigned values for 32-bit fields with the top bit set', () => {
    const b = new BitPackedBuffer(Uint8Array.from([0xff, 0xff, 0xff, 0xff]));
    expect(b.readBits(32)).toBe(0xffffffff); // the 2018 port returned -1 here
  });

  it('is exact to 53 bits', () => {
    const b = new BitPackedBuffer(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f]));
    expect(b.readBits(53)).toBe(2 ** 53 - 1);
  });

  it('reads little-endian when asked', () => {
    const b = new BitPackedBuffer(Uint8Array.from([0x34, 0x12]), 'little');
    expect(b.readBits(16)).toBe(0x1234);
  });

  it('throws TruncatedError past the end, naming the position', () => {
    const b = new BitPackedBuffer(Uint8Array.from([1]));
    b.readBits(8);
    expect(() => b.readBits(1)).toThrow(TruncatedError);
    expect(() => b.readAlignedBytes(1)).toThrow(/\[1\]/);
  });

  it('a fourcc at an unaligned position is one 32-bit read, not four byte reads', () => {
    // After consuming 3 bits, a 32-bit read must take the remaining 5 bits of
    // the first byte, then three whole bytes, then 3 bits of the fifth — the
    // fifth byte's LOW bits — exactly as Blizzard's read_bits(32) does.
    const data = Uint8Array.from([0b11111000, 0x53, 0x54, 0x55, 0b00000101, 0x00]);
    const wide = new BitPackedBuffer(data);
    wide.readBits(3);
    const w = wide.readFourcc();
    const narrow = new BitPackedBuffer(data);
    narrow.readBits(3);
    const n = new Uint8Array(4);
    for (let i = 0; i < 4; i++) n[i] = narrow.readBits(8);
    expect(Array.from(w)).not.toEqual(Array.from(n));
    // value = [5 bits: 11111][0x53][0x54][0x55][3 bits: 101] as one 32-bit number
    const expected = (0b11111 * 2 ** 27 + (0x53 << 19) + (0x54 << 11) + (0x55 << 3) + 0b101) >>> 0;
    const got = ((w[0]! << 24) | (w[1]! << 16) | (w[2]! << 8) | w[3]!) >>> 0;
    expect(got).toBe(expected);
    expect(wide.usedBits).toBe(35);
  });

  it('aligned reads return views, not copies', () => {
    const data = Uint8Array.from([1, 2, 3, 4]);
    const b = new BitPackedBuffer(data);
    const v = b.readAlignedBytes(2);
    expect(v.buffer).toBe(data.buffer);
    expect(Array.from(v)).toEqual([1, 2]);
  });
});

describe('VersionedDecoder', () => {
  // A minimal protocol: type 0 = vint, type 1 = struct { a: vint (tag 0), b: blob (tag 1) }, type 2 = blob
  const def: ProtocolDefinition = {
    build: 1,
    typeinfos: [
      { k: 'int', bounds: [0, 0] },
      {
        k: 'struct',
        fields: [
          ['m_a', 0, 0],
          ['m_b', 2, 1],
        ],
      },
      { k: 'blob', bounds: [0, 0] },
    ],
    gameEventTypes: {},
    messageEventTypes: {},
    trackerEventTypes: {},
    gameEventIdTypeid: 0,
    messageEventIdTypeid: 0,
    trackerEventIdTypeid: 0,
    svaruint32Typeid: 0,
    replayUserIdTypeid: 0,
    headerTypeid: 1,
    detailsTypeid: 1,
    initDataTypeid: 1,
  };

  it('decodes signed variable-length integers', () => {
    // tag 9, then vint: 0x05 -> +2 ; 0x03 -> -1 ; 0x80|0x02, 0x01 -> (1<<6)+1 = 65 -> value +65 ... encoded as bit0 sign
    const d = new VersionedDecoder(Uint8Array.from([9, 0x04, 9, 0x03, 9, 0x82, 0x01]), def);
    expect(d.instance(0)).toBe(2);
    expect(d.instance(0)).toBe(-1);
    expect(d.instance(0)).toBe(65);
  });

  it('skips struct fields the protocol does not know (forward compatibility)', () => {
    // struct tag 5, 3 fields: tag 0 vint 10; tag 7 (unknown) blob "zz"; tag 1 blob "hi"
    const bytes = Uint8Array.from([
      5,
      0x06, // struct, 3 fields (vint 3 -> 0x06)
      0x00,
      9,
      0x14, // tag 0 (vint 0), vint 10 -> 0x14
      0x0e,
      2,
      0x04,
      0x7a,
      0x7a, // tag 7 (vint 7 -> 0x0e), blob len 2 ("zz")
      0x02,
      2,
      0x04,
      0x68,
      0x69, // tag 1 (vint 1 -> 0x02), blob len 2 ("hi")
    ]);
    const d = new VersionedDecoder(bytes, def);
    const v = d.instance(1) as { m_a: number; m_b: Uint8Array };
    expect(v.m_a).toBe(10);
    expect(Array.from(v.m_b)).toEqual([0x68, 0x69]);
    expect(d.isDone).toBe(true);
  });

  it('reports a wrong type tag as CorruptedError', () => {
    const d = new VersionedDecoder(Uint8Array.from([2, 0x02, 0x41]), def);
    expect(() => d.instance(0)).toThrow(CorruptedError);
  });
});
