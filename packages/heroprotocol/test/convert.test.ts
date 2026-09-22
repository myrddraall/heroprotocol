import { describe, expect, it } from 'vitest';
import { convertPythonProtocol } from '../src/protocol/convert.js';
import { BUILD_INDEX, BUNDLED, REPRESENTATIVES } from '../src/protocol/data/index.js';
import { ProtocolConversionError } from '../src/errors.js';
import { readProtocolSource } from './util/node.js';

describe('convertPythonProtocol', () => {
  it('converts the bootstrap protocol', () => {
    const def = convertPythonProtocol(readProtocolSource(29406), 29406);
    expect(def.build).toBe(29406);
    expect(def.typeinfos.length).toBeGreaterThan(150);
    expect(def.svaruint32Typeid).toBe(7);
    expect(def.replayUserIdTypeid).toBe(8);
    expect(def.typeinfos[0]).toEqual({ k: 'int', bounds: [0, 7] });
  });

  it('produces exactly what the generator bundled for the current lineage', async () => {
    const fresh = convertPythonProtocol(readProtocolSource(85027), 85027);
    const bundled = await BUNDLED[85027]!();
    expect(fresh).toEqual(bundled);
    expect(fresh.typeinfos).toHaveLength(213);
  });

  it('parses every typeinfo kind the format uses', () => {
    const def = convertPythonProtocol(readProtocolSource(85027), 85027);
    const kinds = new Set(def.typeinfos.map((t) => t.k));
    for (const k of [
      'int',
      'blob',
      'bool',
      'array',
      'optional',
      'fourcc',
      'bitarray',
      'null',
      'choice',
      'struct',
    ]) {
      expect(kinds, k).toContain(k);
    }
    const struct = def.typeinfos.find(
      (t) => t.k === 'struct' && t.fields.some((f) => f[0] === '__parent'),
    );
    expect(struct).toBeDefined();
    const choice = def.typeinfos[def.svaruint32Typeid];
    expect(choice?.k).toBe('choice');
  });

  it('refuses malformed input rather than producing an empty protocol', () => {
    expect(() => convertPythonProtocol('not a protocol', 1)).toThrow(ProtocolConversionError);
    const src = readProtocolSource(29406).replace("('_int',[(0,7)]),  #0", "('_wat',[(0,7)]),  #0");
    expect(() => convertPythonProtocol(src, 29406)).toThrow(/unknown type kind/);
    const dangling = readProtocolSource(29406).replace(
      /replay_header_typeid = \d+/,
      'replay_header_typeid = 9999',
    );
    expect(() => convertPythonProtocol(dangling, 29406)).toThrow(/references typeid 9999/);
  });
});

describe('bundled data', () => {
  it('indexes every published build to a bundled representative', async () => {
    const builds = Object.keys(BUILD_INDEX).map(Number);
    expect(builds).toHaveLength(390);
    expect(Math.min(...builds)).toBe(29406);
    expect(Math.max(...builds)).toBe(96477);
    expect(REPRESENTATIVES).toHaveLength(36);
    const reps = new Set(REPRESENTATIVES.map((r) => r.build));
    for (const rep of Object.values(BUILD_INDEX))
      expect(reps.has(rep), `representative ${rep}`).toBe(true);
    for (const rep of reps) expect(BUNDLED[rep], `loader for ${rep}`).toBeTypeOf('function');
  });

  it('maps the newest published builds onto the 85027 lineage', () => {
    expect(BUILD_INDEX['96477']).toBe(85027);
    expect(BUILD_INDEX['85027']).toBe(85027);
    expect(BUILD_INDEX['84249']).toBe(69947);
  });

  it('every bundled definition loads and self-validates', async () => {
    for (const { build } of REPRESENTATIVES) {
      const def = await BUNDLED[build]!();
      expect(def.build).toBe(build);
      expect(def.typeinfos[def.headerTypeid]?.k).toBe('struct');
      expect(def.typeinfos[def.detailsTypeid]?.k).toBe('struct');
      expect(def.typeinfos[def.initDataTypeid]?.k).toBe('struct');
    }
  });
});
